import fnmatch
import hashlib
import json
import re
import tarfile
import zipfile
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from packaging.version import Version

BUNDLE = Path("/app/bundle")
ARTIFACTS = BUNDLE / "artifacts"


def _load_json(path: Path):
    return json.loads(path.read_text())


def _issue(code: str, path: str, detail: str) -> dict:
    return {"code": code, "path": path, "detail": detail}


def _unfold_headers(text: str) -> str:
    lines = text.splitlines()
    unfolded: list[str] = []
    for line in lines:
        if line.startswith((" ", "\t")) and unfolded:
            unfolded[-1] += " " + line.strip()
        else:
            unfolded.append(line)
    return "\n".join(unfolded)


def _is_exempt_unmanifested(name: str, policy: dict) -> bool:
    for pattern in policy.get("unmanifested_exempt_globs", []):
        if fnmatch.fnmatch(name, pattern):
            return True
    return False


def _wheel_tag(filename: str) -> str:
    stem = filename.removesuffix(".whl")
    parts = stem.split("-")
    if len(parts) < 5:
        return ""
    return "-".join(parts[-3:])


def _filename_version(filename: str) -> str:
    stem = filename.removesuffix(".whl")
    parts = stem.split("-")
    if len(parts) < 2:
        return ""
    return parts[1]


def _metadata_path(project: str, manifest_version: str) -> str:
    return f"{project}-{manifest_version}.dist-info/METADATA"


def _parse_metadata_fields(text: str) -> dict[str, str | list[str]]:
    text = _unfold_headers(text)
    name = None
    version = None
    requires: list[str] = []
    for line in text.splitlines():
        if line.startswith("Name:"):
            name = line.split(":", 1)[1].strip()
        elif line.startswith("Version:"):
            version = line.split(":", 1)[1].strip()
        elif line.startswith("Requires-Dist:"):
            requires.append(line.split(":", 1)[1].strip())
    if version is None:
        raise ValueError("no Version in METADATA/PKG-INFO")
    return {"name": name or "", "version": version, "requires_dist": requires}


def _read_wheel_metadata(path: Path, project: str, manifest_version: str) -> tuple[dict[str, str | list[str]], str | None]:
    meta_rel = _metadata_path(project, manifest_version)
    internal_tag = None
    with zipfile.ZipFile(path) as zf:
        if meta_rel not in zf.namelist():
            raise ValueError(f"missing {meta_rel} in {path}")
        meta = _parse_metadata_fields(zf.read(meta_rel).decode())
        wheel_rel = meta_rel.replace("/METADATA", "/WHEEL")
        if wheel_rel in zf.namelist():
            for line in zf.read(wheel_rel).decode().splitlines():
                if line.startswith("Tag:"):
                    internal_tag = line.split(":", 1)[1].strip()
                    break
    return meta, internal_tag


def _stale_wheel_dist_infos(path: Path, project: str, manifest_version: str) -> list[tuple[str, str]]:
    selected = _metadata_path(project, manifest_version)
    stale: list[tuple[str, str]] = []
    with zipfile.ZipFile(path) as zf:
        for name in zf.namelist():
            if not name.endswith(".dist-info/METADATA") or name == selected:
                continue
            fields = _parse_metadata_fields(zf.read(name).decode())
            dist_name = name.split("/")[0].removesuffix(".dist-info")
            stale.append((dist_name, str(fields["version"])))
    return stale


def _primary_pkginfo_path(archive_name: str) -> str:
    return f"{archive_name.removesuffix('.tar.gz')}/PKG-INFO"


def _read_primary_sdist_version(path: Path) -> str:
    primary = _primary_pkginfo_path(path.name)
    with tarfile.open(path, "r:gz") as tf:
        pkg = next(m for m in tf.getmembers() if m.name == primary)
        fields = _parse_metadata_fields(tf.extractfile(pkg).read().decode())
    return str(fields["version"])


def _stale_sdist_pkginfos(path: Path) -> list[tuple[str, str]]:
    primary = _primary_pkginfo_path(path.name)
    stale: list[tuple[str, str]] = []
    with tarfile.open(path, "r:gz") as tf:
        for member in tf.getmembers():
            if not member.name.endswith("/PKG-INFO") or member.name == primary:
                continue
            fields = _parse_metadata_fields(tf.extractfile(member).read().decode())
            stale.append((member.name, str(fields["version"])))
    return stale


def _pep440_equal(a: str, b: str) -> bool:
    return Version(a) == Version(b)


def _normalized_requires(requires: list[str]) -> tuple[str, ...]:
    normalized = []
    for req in requires:
        r = Requirement(req)
        normalized.append(f"{r.name.lower()}=={r.specifier}" if r.specifier else r.name.lower())
    return tuple(sorted(normalized))


def _cpython_minor_from_tag(tag: str) -> int | None:
    m = re.search(r"cp(\d{2,3})", tag)
    if not m:
        return None
    digits = m.group(1)
    if len(digits) == 2:
        return int(digits[1])
    return int(digits[1:])


def main():
    manifest = _load_json(BUNDLE / "manifest.json")
    policy = _load_json(BUNDLE / "policy.json")
    manifest_by_name = {a["path"]: a for a in manifest["artifacts"]}
    disk_names = sorted(p.name for p in ARTIFACTS.iterdir() if p.is_file())
    disk_set = set(disk_names)
    min_py = Version(policy["minimum_python_version"])
    project = manifest["project"]

    issues: list[dict] = []

    for name in disk_names:
        if name in manifest_by_name:
            continue
        if _is_exempt_unmanifested(name, policy):
            continue
        issues.append(
            _issue(
                "UNMANIFESTED_ARTIFACT",
                name,
                "file exists under artifacts/ but is not listed in manifest.json",
            )
        )

    reference_requires: tuple[str, ...] | None = None
    reference_wheel: str | None = None

    for entry in manifest["artifacts"]:
        name = entry["path"]
        path = ARTIFACTS / name
        if not path.exists():
            issues.append(
                _issue("MISSING_ARTIFACT", name, "manifest entry is absent from artifacts/")
            )
            continue

        if not _pep440_equal(entry["version"], manifest["release_version"]):
            issues.append(
                _issue(
                    "MANIFEST_ARTIFACT_RELEASE_VERSION_MISMATCH",
                    name,
                    f"manifest artifact version {entry['version']} is not PEP 440-equal to release_version {manifest['release_version']}",
                )
            )

        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != entry["sha256"]:
            issues.append(
                _issue("CHECKSUM_MISMATCH", name, f"sha256 {digest} != manifest {entry['sha256']}")
            )
        if len(data) != entry["size_bytes"]:
            issues.append(
                _issue(
                    "SIZE_MISMATCH",
                    name,
                    f"size {len(data)} != manifest {entry['size_bytes']}",
                )
            )

        if name.endswith(".whl"):
            if policy.get("require_wheel_signature_sidecars"):
                sidecar = f"{name}.asc"
                if sidecar not in disk_set:
                    issues.append(
                        _issue(
                            "MISSING_SIGNATURE_SIDECAR",
                            name,
                            f"missing required signature sidecar {sidecar}",
                        )
                    )

            meta, internal_tag = _read_wheel_metadata(path, project, entry["version"])
            if not _pep440_equal(str(meta["version"]), entry["version"]):
                issues.append(
                    _issue(
                        "METADATA_VERSION_MISMATCH",
                        name,
                        f"METADATA Version {meta['version']} is not PEP 440-equal to manifest version {entry['version']}",
                    )
                )
            if not _pep440_equal(str(meta["version"]), manifest["release_version"]):
                issues.append(
                    _issue(
                        "WHEEL_RELEASE_VERSION_MISMATCH",
                        name,
                        f"METADATA Version {meta['version']} is not PEP 440-equal to release_version {manifest['release_version']}",
                    )
                )

            filename_version = _filename_version(name)
            if filename_version and not _pep440_equal(filename_version, entry["version"]):
                issues.append(
                    _issue(
                        "WHEEL_FILENAME_VERSION_MISMATCH",
                        name,
                        f"wheel filename version {filename_version} is not PEP 440-equal to manifest version {entry['version']}",
                    )
                )

            meta_name = str(meta.get("name", ""))
            normalized_meta = canonicalize_name(meta_name) if meta_name else ""
            normalized_project = canonicalize_name(project)
            if meta_name and normalized_meta != normalized_project:
                issues.append(
                    _issue(
                        "METADATA_NAME_MISMATCH",
                        name,
                        f"METADATA Name {meta_name} normalizes to {normalized_meta}, manifest project {project} normalizes to {normalized_project}",
                    )
                )

            filename_tag = _wheel_tag(name)
            if internal_tag is not None and internal_tag != filename_tag:
                issues.append(
                    _issue(
                        "WHEEL_INTERNAL_TAG_MISMATCH",
                        name,
                        f"WHEEL file Tag {internal_tag} differs from filename wheel tag {filename_tag}",
                    )
                )

            tag = filename_tag
            for forbidden in policy["forbidden_tag_substrings"]:
                if forbidden in tag:
                    issues.append(
                        _issue(
                            "FORBIDDEN_WHEEL_TAG",
                            name,
                            f"wheel tag contains forbidden substring '{forbidden}'",
                        )
                    )
                    break

            cp_minor = _cpython_minor_from_tag(tag)
            if cp_minor is not None and Version(f"3.{cp_minor}") < min_py:
                issues.append(
                    _issue(
                        "PYTHON_TAG_BELOW_MINIMUM",
                        name,
                        f"wheel tag implies Python 3.{cp_minor}, below policy minimum_python_version {policy['minimum_python_version']}",
                    )
                )

            if policy.get("requires_dist_must_match_across_wheels"):
                req_set = _normalized_requires(list(meta["requires_dist"]))
                if reference_requires is None:
                    reference_requires = req_set
                    reference_wheel = name
                elif req_set != reference_requires:
                    issues.append(
                        _issue(
                            "REQUIRES_DIST_MISMATCH",
                            name,
                            f"Requires-Dist set differs from {reference_wheel}",
                        )
                    )

            for dist_info_name, stale_version in _stale_wheel_dist_infos(path, project, entry["version"]):
                if not _pep440_equal(stale_version, entry["version"]):
                    issues.append(
                        _issue(
                            "STALE_DIST_INFO_VERSION_MISMATCH",
                            name,
                            f"stale dist-info {dist_info_name} Version {stale_version} is not PEP 440-equal to manifest version {entry['version']}",
                        )
                    )

    if policy.get("require_sdist_in_manifest"):
        if not any(a["path"].endswith(".tar.gz") for a in manifest["artifacts"]):
            issues.append(
                _issue(
                    "SDIST_MISSING_FROM_MANIFEST",
                    "",
                    "policy requires a .tar.gz entry in manifest.json but none is listed",
                )
            )

    for name in disk_names:
        if not name.endswith(".tar.gz"):
            continue
        sdist_path = ARTIFACTS / name
        meta_ver = _read_primary_sdist_version(sdist_path)
        expected = manifest["release_version"]
        if not _pep440_equal(meta_ver, expected):
            issues.append(
                _issue(
                    "SDIST_METADATA_VERSION_MISMATCH",
                    name,
                    f"PKG-INFO Version {meta_ver} is not PEP 440-equal to release_version {expected}",
                )
            )
        for member_path, stale_ver in _stale_sdist_pkginfos(sdist_path):
            if not _pep440_equal(stale_ver, expected):
                issues.append(
                    _issue(
                        "STALE_PKGINFO_VERSION_MISMATCH",
                        name,
                        f"stale PKG-INFO at {member_path} Version {stale_ver} is not PEP 440-equal to release_version {expected}",
                    )
                )

    issues.sort(key=lambda i: (i["code"], i["path"], i["detail"]))
    out = {
        "release_version": manifest["release_version"],
        "gate_passed": len(issues) == 0,
        "blocking_issue_count": len(issues),
        "blocking_issues": issues,
        "manifested_artifact_count": len(manifest["artifacts"]),
        "disk_artifact_count": len(disk_names),
    }
    Path("/app/release_gate.json").write_text(json.dumps(out, indent=2) + "\n")
    print("wrote /app/release_gate.json")


if __name__ == "__main__":
    main()

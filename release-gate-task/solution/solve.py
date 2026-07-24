import json
import re
import tarfile
import zipfile
from pathlib import Path

BUNDLE = Path("/app/bundle")
ARTIFACTS = BUNDLE / "artifacts"


def _load_json(path: Path):
    return json.loads(path.read_text())


def _wheel_tags(filename: str) -> list[str]:
    stem = filename.removesuffix(".whl")
    parts = stem.split("-")
    if len(parts) < 5:
        return []
    return ["-".join(parts[-3:])]


def _metadata_version_wheel(path: Path) -> str:
    with zipfile.ZipFile(path) as zf:
        meta_name = next(n for n in zf.namelist() if n.endswith(".dist-info/METADATA"))
        for line in zf.read(meta_name).decode().splitlines():
            if line.startswith("Version:"):
                return line.split(":", 1)[1].strip()
    raise ValueError(f"no Version in {path}")


def _metadata_version_sdist(path: Path) -> str:
    with tarfile.open(path, "r:gz") as tf:
        pkg = next(m for m in tf.getmembers() if m.name.endswith("/PKG-INFO"))
        text = tf.extractfile(pkg).read().decode()
    for line in text.splitlines():
        if line.startswith("Version:"):
            return line.split(":", 1)[1].strip()
    raise ValueError(f"no Version in {path}")


def _issue(code: str, path: str, detail: str) -> dict:
    return {"code": code, "path": path, "detail": detail}


def main():
    manifest = _load_json(BUNDLE / "manifest.json")
    policy = _load_json(BUNDLE / "policy.json")
    manifest_by_name = {a["path"]: a for a in manifest["artifacts"]}
    disk_names = sorted(p.name for p in ARTIFACTS.iterdir() if p.is_file())

    issues: list[dict] = []

    for name in disk_names:
        if name not in manifest_by_name:
            issues.append(
                _issue(
                    "UNMANIFESTED_ARTIFACT",
                    name,
                    "file exists under artifacts/ but is not listed in manifest.json",
                )
            )

    for entry in manifest["artifacts"]:
        name = entry["path"]
        path = ARTIFACTS / name
        if not path.exists():
            issues.append(
                _issue("MISSING_ARTIFACT", name, "manifest entry is absent from artifacts/")
            )
            continue

        data = path.read_bytes()
        digest = __import__("hashlib").sha256(data).hexdigest()
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
            meta_ver = _metadata_version_wheel(path)
            if meta_ver != entry["version"]:
                issues.append(
                    _issue(
                        "METADATA_VERSION_MISMATCH",
                        name,
                        f"METADATA Version {meta_ver} != manifest version {entry['version']}",
                    )
                )
            tag = _wheel_tags(name)[0] if _wheel_tags(name) else ""
            for forbidden in policy["forbidden_tag_substrings"]:
                if forbidden in tag:
                    issues.append(
                        _issue(
                            "FORBIDDEN_WHEEL_TAG",
                            name,
                            f"wheel tag contains forbidden substring {forbidden!r}",
                        )
                    )
                    break

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
        path = ARTIFACTS / name
        meta_ver = _metadata_version_sdist(path)
        expected = manifest["release_version"]
        if meta_ver != expected:
            issues.append(
                _issue(
                    "SDIST_METADATA_VERSION_MISMATCH",
                    name,
                    f"PKG-INFO Version {meta_ver} != release_version {expected}",
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

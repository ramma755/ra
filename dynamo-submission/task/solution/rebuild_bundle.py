#!/usr/bin/env python3
"""Rebuild release-gate bundle fixtures (run from task/)."""
import hashlib
import io
import json
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "environment" / "data" / "bundle" / "artifacts"
MANIFEST = ROOT / "environment" / "data" / "bundle" / "manifest.json"


def wheel_bytes(
    metadata_blocks: list[tuple[str, str]],
    wheel_tags: list[str],
    extra_files: dict[str, str] | None = None,
) -> bytes:
    """Build a wheel. metadata_blocks order is zip member order (decoys first).

    wheel_tags: one or more Tag values written in order; gate uses the first Tag: line.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr("widgetlib/__init__.py", "# widgetlib\n")
        for dist_name, metadata in metadata_blocks:
            prefix = f"{dist_name}.dist-info"
            z.writestr(f"{prefix}/METADATA", metadata)
            tag_lines = "".join(f"Tag: {t}\n" for t in wheel_tags)
            z.writestr(
                f"{prefix}/WHEEL",
                "Wheel-Version: 1.0\nGenerator: release-gate-fixture\n"
                f"Root-Is-Purelib: false\n{tag_lines}",
            )
            z.writestr(f"{prefix}/RECORD", "widgetlib/__init__.py,,\n")
        for path, content in (extra_files or {}).items():
            z.writestr(path, content)
    return buf.getvalue()


def write_wheel(name: str, data: bytes) -> tuple[str, int]:
    (ART / name).write_bytes(data)
    return hashlib.sha256(data).hexdigest(), len(data)


def main():
    ART.mkdir(parents=True, exist_ok=True)
    for stale in ART.glob("*"):
        if stale.is_file():
            stale.unlink()
        elif stale.is_dir():
            for child in stale.rglob("*"):
                if child.is_file():
                    child.unlink()

    # Reference wheel: selected dist-info path uses literal manifest version 2.0.09.
    # Decoy dist-info is written first so "first METADATA" solvers pick the wrong tree.
    # Requires-Dist includes extras + environment markers that must be stripped.
    meta312_stale = """Metadata-Version: 2.1
Name: widgetlib
Version: 2.0.8
Requires-Dist: requests==2.31.0
"""
    meta312 = """Metadata-Version: 2.1
Name: widgetlib
Version: 2.0.09
Requires-Dist: requests[security]==2.31.0; python_version >= "3.8"
Requires-Dist: certifi (>=2024.2.2,
    <2025)
"""
    sha312, sz312 = write_wheel(
        "widgetlib-2.0.9-cp312-cp312-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl",
        wheel_bytes(
            [("widgetlib-2.0.9", meta312_stale), ("widgetlib-2.0.09", meta312)],
            ["cp312-cp312-manylinux_2_28_x86_64.manylinux_2_28_x86_64"],
        ),
    )

    # Universal wheel: decoy (matching filename version) listed before selected post1.
    meta_uni_decoy = """Metadata-Version: 2.1
Name: widgetlib
Version: 2.0.9
Requires-Dist: requests==2.31.0
"""
    meta_uni = """Metadata-Version: 2.1
Name: widgetlib
Version:
 2.0.9.post1
Requires-Dist: requests[security]==2.31.0; python_version >= "3.8"
Requires-Dist: certifi (>=2024.2.2,
    <2025)
"""
    sha_uni, sz_uni = write_wheel(
        "widgetlib-2.0.9-py3-none-any.whl",
        wheel_bytes(
            [("widgetlib-2.0.9", meta_uni_decoy), ("widgetlib-2.0.9.post1", meta_uni)],
            ["py3-none-any"],
        ),
    )

    # cp310: first Tag: is wrong; a second correct Tag: is a decoy for last-Tag solvers.
    meta310 = """Metadata-Version: 2.1
Name: widgetlib
Version: 2.0.9
Requires-Dist: requests==2.31.0
"""
    meta310_stale = """Metadata-Version: 2.1
Name: widgetlib
Version: 2.0.8
Requires-Dist: requests==2.31.0
"""
    sha310, sz310 = write_wheel(
        "widgetlib-2.0.9-cp310-cp310-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl",
        wheel_bytes(
            [("widgetlib-2.0.8", meta310_stale), ("widgetlib-2.0.9", meta310)],
            [
                "cp310-cp310-manylinux_2_17_x86_64",
                "cp310-cp310-manylinux_2_28_x86_64.manylinux_2_28_x86_64",
            ],
        ),
    )

    meta311 = """Metadata-Version: 2.1
Name: Widget_Lib
Version: 2.0.9
Requires-Dist: requests==2.31.0
Requires-Dist: certifi>=2024.2.2
Requires-Dist: urllib3 (<3,
    !=2.2.0)
"""
    sha311, sz311 = write_wheel(
        "widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl",
        wheel_bytes(
            [("widgetlib-2.0.9.dev0", meta311)],
            ["cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64"],
        ),
    )

    # "Looks clean" wheel — Requires-Dist matches only after marker/extra stripping + unfold.
    # Manifest will deliberately corrupt sha256 and size_bytes after hashing.
    meta311_ok = """Metadata-Version: 2.1
Name: widgetlib
Version: 2.0.9
Requires-Dist: requests[socks]==2.31.0; extra == "dev"
Requires-Dist: certifi (>=2024.2.2,
    <2025)
"""
    sha311ok_real, sz311ok_real = write_wheel(
        "widgetlib-2.0.9-cp311-cp311-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl",
        wheel_bytes(
            [("widgetlib-2.0.9", meta311_ok)],
            ["cp311-cp311-manylinux_2_28_x86_64.manylinux_2_28_x86_64"],
        ),
    )
    # Corrupt manifest checksum/size (on-disk bytes stay as written above).
    sha311ok = ("0" + sha311ok_real[1:]) if sha311ok_real[0] != "0" else ("1" + sha311ok_real[1:])
    sz311ok = sz311ok_real + 17

    meta39 = """Metadata-Version: 2.1
Name: widgetlib
Version: 2.0.9
Requires-Dist: requests[security]==2.31.0; python_version >= "3.8"
Requires-Dist: certifi (>=2024.2.2,
    <2025)
"""
    sha39, sz39 = write_wheel(
        "widgetlib-2.0.9-cp39-abi3-linux_x86_64.whl",
        wheel_bytes([("widgetlib-2.0.9", meta39)], ["cp39-abi3-linux_x86_64"]),
    )

    # Stale PKG-INFO member is archived first; primary path is basename/PKG-INFO.
    sdist_buf = io.BytesIO()
    with tarfile.open(fileobj=sdist_buf, mode="w:gz") as tf:
        pkg = """Metadata-Version: 2.1
Name: widgetlib
Version: 2.0.8
"""
        stale_pkg = """Metadata-Version: 2.1
Name: widgetlib
Version: 2.0.7
"""
        for name, body in (
            ("widgetlib-2.0.9/stale/PKG-INFO", stale_pkg),
            ("widgetlib-2.0.9/PKG-INFO", pkg),
            ("widgetlib-2.0.8/PKG-INFO", "Metadata-Version: 2.1\nName: widgetlib\nVersion: 1.0.0\n"),
        ):
            info = tarfile.TarInfo(name)
            data = body.encode()
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
        info2 = tarfile.TarInfo("widgetlib-2.0.9/pyproject.toml")
        data2 = b"[project]\nname='widgetlib'\n"
        info2.size = len(data2)
        tf.addfile(info2, io.BytesIO(data2))
    (ART / "widgetlib-2.0.9.tar.gz").write_bytes(sdist_buf.getvalue())

    (ART / "SHA256SUMS").write_text(
        "# DO NOT TRUST — stale sidecar checksums\n"
        "widgetlib-2.0.9-py3-none-any.whl deadbeef\n"
        f"widgetlib-2.0.9-cp311-cp311-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl {sha311ok_real}\n"
    )
    (ART / "widgetlib-2.0.9-py3-none-any.whl.asc").write_text(
        "-----BEGIN PGP SIGNATURE-----\nstub\n"
    )
    (ART / ".buildmeta").write_text("build-id=local-staging\n")
    (ART / "_internal" / "README.txt").parent.mkdir(parents=True, exist_ok=True)
    (ART / "_internal" / "README.txt").write_text("staging only\n")

    missing_name = (
        "widgetlib-2.0.9-cp313-cp313-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl"
    )

    manifest = {
        "release_version": "2.0.9",
        "project": "widgetlib",
        "artifacts": [
            {
                "path": "widgetlib-2.0.9-cp312-cp312-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl",
                "kind": "wheel",
                "version": "2.0.09",
                "sha256": sha312,
                "size_bytes": sz312,
            },
            {
                "path": "widgetlib-2.0.9-py3-none-any.whl",
                "kind": "wheel",
                "version": "2.0.9.post1",
                "sha256": sha_uni,
                "size_bytes": sz_uni,
            },
            {
                "path": "widgetlib-2.0.9-cp310-cp310-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl",
                "kind": "wheel",
                "version": "2.0.9",
                "sha256": sha310,
                "size_bytes": sz310,
            },
            {
                "path": "widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl",
                "kind": "wheel",
                "version": "2.0.9.dev0",
                "sha256": sha311,
                "size_bytes": sz311,
            },
            {
                "path": "widgetlib-2.0.9-cp39-abi3-linux_x86_64.whl",
                "kind": "wheel",
                "version": "2.0.9",
                "sha256": sha39,
                "size_bytes": sz39,
            },
            {
                "path": "widgetlib-2.0.9-cp311-cp311-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl",
                "kind": "wheel",
                "version": "2.0.9",
                "sha256": sha311ok,
                "size_bytes": sz311ok,
            },
            {
                "path": missing_name,
                "kind": "wheel",
                "version": "2.0.9",
                "sha256": "a" * 64,
                "size_bytes": 1,
            },
        ],
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print("real sha311ok", sha311ok_real, "manifest", sha311ok, "size", sz311ok_real, "->", sz311ok)
    print("wheels built; disk files:", sorted(p.name for p in ART.iterdir() if p.is_file()))


if __name__ == "__main__":
    main()

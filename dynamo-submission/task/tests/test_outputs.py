import json
from pathlib import Path

REPORT = Path("/app/release_gate.json")

EXPECTED_ISSUES = json.loads(
    """[
    {"code": "FORBIDDEN_WHEEL_TAG", "path": "widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl", "detail": "wheel tag contains forbidden substring 'manylinux2014'"},
    {"code": "MANIFEST_ARTIFACT_RELEASE_VERSION_MISMATCH", "path": "widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl", "detail": "manifest artifact version 2.0.9.dev0 is not PEP 440-equal to release_version 2.0.9"},
    {"code": "MANIFEST_ARTIFACT_RELEASE_VERSION_MISMATCH", "path": "widgetlib-2.0.9-py3-none-any.whl", "detail": "manifest artifact version 2.0.9.post1 is not PEP 440-equal to release_version 2.0.9"},
    {"code": "METADATA_NAME_MISMATCH", "path": "widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl", "detail": "METADATA Name Widget_Lib normalizes to widget-lib, manifest project widgetlib normalizes to widgetlib"},
    {"code": "METADATA_VERSION_MISMATCH", "path": "widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl", "detail": "METADATA Version 2.0.9 is not PEP 440-equal to manifest version 2.0.9.dev0"},
    {"code": "MISSING_SIGNATURE_SIDECAR", "path": "widgetlib-2.0.9-cp310-cp310-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl", "detail": "missing required signature sidecar widgetlib-2.0.9-cp310-cp310-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl.asc"},
    {"code": "MISSING_SIGNATURE_SIDECAR", "path": "widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl", "detail": "missing required signature sidecar widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl.asc"},
    {"code": "MISSING_SIGNATURE_SIDECAR", "path": "widgetlib-2.0.9-cp311-cp311-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl", "detail": "missing required signature sidecar widgetlib-2.0.9-cp311-cp311-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl.asc"},
    {"code": "MISSING_SIGNATURE_SIDECAR", "path": "widgetlib-2.0.9-cp312-cp312-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl", "detail": "missing required signature sidecar widgetlib-2.0.9-cp312-cp312-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl.asc"},
    {"code": "MISSING_SIGNATURE_SIDECAR", "path": "widgetlib-2.0.9-cp39-abi3-linux_x86_64.whl", "detail": "missing required signature sidecar widgetlib-2.0.9-cp39-abi3-linux_x86_64.whl.asc"},
    {"code": "PYTHON_TAG_BELOW_MINIMUM", "path": "widgetlib-2.0.9-cp310-cp310-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl", "detail": "wheel tag implies Python 3.10, below policy minimum_python_version 3.11"},
    {"code": "PYTHON_TAG_BELOW_MINIMUM", "path": "widgetlib-2.0.9-cp39-abi3-linux_x86_64.whl", "detail": "wheel tag implies Python 3.9, below policy minimum_python_version 3.11"},
    {"code": "REQUIRES_DIST_MISMATCH", "path": "widgetlib-2.0.9-cp310-cp310-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl", "detail": "Requires-Dist set differs from widgetlib-2.0.9-cp312-cp312-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl"},
    {"code": "REQUIRES_DIST_MISMATCH", "path": "widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl", "detail": "Requires-Dist set differs from widgetlib-2.0.9-cp312-cp312-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl"},
    {"code": "SDIST_METADATA_VERSION_MISMATCH", "path": "widgetlib-2.0.9.tar.gz", "detail": "PKG-INFO Version 2.0.8 is not PEP 440-equal to release_version 2.0.9"},
    {"code": "SDIST_MISSING_FROM_MANIFEST", "path": "", "detail": "policy requires a .tar.gz entry in manifest.json but none is listed"},
    {"code": "STALE_DIST_INFO_VERSION_MISMATCH", "path": "widgetlib-2.0.9-cp310-cp310-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl", "detail": "stale dist-info widgetlib-2.0.8 Version 2.0.8 is not PEP 440-equal to manifest version 2.0.9"},
    {"code": "STALE_DIST_INFO_VERSION_MISMATCH", "path": "widgetlib-2.0.9-cp312-cp312-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl", "detail": "stale dist-info widgetlib-2.0.9 Version 2.0.8 is not PEP 440-equal to manifest version 2.0.09"},
    {"code": "STALE_DIST_INFO_VERSION_MISMATCH", "path": "widgetlib-2.0.9-py3-none-any.whl", "detail": "stale dist-info widgetlib-2.0.9 Version 2.0.9 is not PEP 440-equal to manifest version 2.0.9.post1"},
    {"code": "STALE_PKGINFO_VERSION_MISMATCH", "path": "widgetlib-2.0.9.tar.gz", "detail": "stale PKG-INFO at widgetlib-2.0.9/stale/PKG-INFO Version 2.0.7 is not PEP 440-equal to release_version 2.0.9"},
    {"code": "UNMANIFESTED_ARTIFACT", "path": ".buildmeta", "detail": "file exists under artifacts/ but is not listed in manifest.json"},
    {"code": "UNMANIFESTED_ARTIFACT", "path": "SHA256SUMS", "detail": "file exists under artifacts/ but is not listed in manifest.json"},
    {"code": "UNMANIFESTED_ARTIFACT", "path": "widgetlib-2.0.9.tar.gz", "detail": "file exists under artifacts/ but is not listed in manifest.json"},
    {"code": "WHEEL_FILENAME_VERSION_MISMATCH", "path": "widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl", "detail": "wheel filename version 2.0.9 is not PEP 440-equal to manifest version 2.0.9.dev0"},
    {"code": "WHEEL_FILENAME_VERSION_MISMATCH", "path": "widgetlib-2.0.9-py3-none-any.whl", "detail": "wheel filename version 2.0.9 is not PEP 440-equal to manifest version 2.0.9.post1"},
    {"code": "WHEEL_INTERNAL_TAG_MISMATCH", "path": "widgetlib-2.0.9-cp310-cp310-manylinux_2_28_x86_64.manylinux_2_28_x86_64.whl", "detail": "WHEEL file Tag cp310-cp310-manylinux_2_17_x86_64 differs from filename wheel tag cp310-cp310-manylinux_2_28_x86_64.manylinux_2_28_x86_64"},
    {"code": "WHEEL_RELEASE_VERSION_MISMATCH", "path": "widgetlib-2.0.9-py3-none-any.whl", "detail": "METADATA Version 2.0.9.post1 is not PEP 440-equal to release_version 2.0.9"}
]"""
)


def _load():
    return json.loads(REPORT.read_text())


def test_report_exists():
    """The agent must write the gate report to /app/release_gate.json."""
    assert REPORT.exists(), "no /app/release_gate.json found"


def test_report_is_valid_json_object():
    """release_gate.json must contain a single JSON object."""
    assert isinstance(_load(), dict), "release_gate.json is not a JSON object"


def test_required_keys_present():
    """release_gate.json must contain all six required top-level keys."""
    required = {
        "release_version",
        "gate_passed",
        "blocking_issue_count",
        "blocking_issues",
        "manifested_artifact_count",
        "disk_artifact_count",
    }
    assert required <= _load().keys()


def test_release_version_matches_manifest():
    """release_version must be copied from manifest.json (2.0.9)."""
    assert _load()["release_version"] == "2.0.9"


def test_gate_passed_is_false():
    """gate_passed must be false because the bundle has blocking issues."""
    assert _load()["gate_passed"] is False


def test_blocking_issue_count():
    """blocking_issue_count must equal the number of blocking issues (27)."""
    data = _load()
    assert data["blocking_issue_count"] == 27
    assert data["blocking_issue_count"] == len(data["blocking_issues"])


def test_blocking_issues_exact_and_sorted():
    """blocking_issues must list every rule violation with exact detail templates, sorted by (code, path, detail)."""
    issues = _load()["blocking_issues"]
    assert issues == sorted(issues, key=lambda i: (i["code"], i["path"], i["detail"]))
    assert issues == EXPECTED_ISSUES


def test_sdist_double_emission_required():
    """Both SDIST_MISSING_FROM_MANIFEST and UNMANIFESTED_ARTIFACT must be emitted for the sdist."""
    codes = {i["code"] for i in _load()["blocking_issues"]}
    assert "SDIST_MISSING_FROM_MANIFEST" in codes
    assert "UNMANIFESTED_ARTIFACT" in codes


def test_asc_sidecar_exempt_from_unmanifested():
    """*.asc files exempted by policy must not appear as UNMANIFESTED_ARTIFACT."""
    issues = _load()["blocking_issues"]
    asc_unmanifested = [
        i for i in issues if i["code"] == "UNMANIFESTED_ARTIFACT" and i["path"].endswith(".asc")
    ]
    assert asc_unmanifested == []


def test_stale_dist_info_issues_present():
    """STALE_DIST_INFO_VERSION_MISMATCH must be emitted for decoy dist-info trees."""
    codes = {i["code"] for i in _load()["blocking_issues"]}
    assert "STALE_DIST_INFO_VERSION_MISMATCH" in codes
    assert "STALE_PKGINFO_VERSION_MISMATCH" in codes


def test_manifested_artifact_count():
    """manifested_artifact_count must equal manifest.json artifact entries (6)."""
    assert _load()["manifested_artifact_count"] == 6


def test_disk_artifact_count():
    """disk_artifact_count must equal files under /app/bundle/artifacts/ (10)."""
    assert _load()["disk_artifact_count"] == 10

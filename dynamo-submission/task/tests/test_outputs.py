import json
from pathlib import Path

REPORT = Path("/app/release_gate.json")

EXPECTED_ISSUES = [
    {
        "code": "FORBIDDEN_WHEEL_TAG",
        "path": "widgetlib-2.0.9-cp311-cp311-manylinux2014_x86_64.manylinux2014_x86_64.whl",
        "detail": "wheel tag contains forbidden substring 'manylinux2014'",
    },
    {
        "code": "SDIST_METADATA_VERSION_MISMATCH",
        "path": "widgetlib-2.0.9.tar.gz",
        "detail": "PKG-INFO Version 2.0.8 != release_version 2.0.9",
    },
    {
        "code": "SDIST_MISSING_FROM_MANIFEST",
        "path": "",
        "detail": "policy requires a .tar.gz entry in manifest.json but none is listed",
    },
    {
        "code": "UNMANIFESTED_ARTIFACT",
        "path": "widgetlib-2.0.9.tar.gz",
        "detail": "file exists under artifacts/ but is not listed in manifest.json",
    },
]


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
    """blocking_issue_count must equal the number of blocking issues (4)."""
    data = _load()
    assert data["blocking_issue_count"] == 4
    assert data["blocking_issue_count"] == len(data["blocking_issues"])


def test_blocking_issues_exact_and_sorted():
    """blocking_issues must list every rule violation, sorted by (code, path, detail)."""
    issues = _load()["blocking_issues"]
    assert issues == sorted(issues, key=lambda i: (i["code"], i["path"], i["detail"]))
    assert issues == EXPECTED_ISSUES


def test_manifested_artifact_count():
    """manifested_artifact_count must equal manifest.json artifact entries (2)."""
    assert _load()["manifested_artifact_count"] == 2


def test_disk_artifact_count():
    """disk_artifact_count must equal files under /app/bundle/artifacts/ (3)."""
    assert _load()["disk_artifact_count"] == 3

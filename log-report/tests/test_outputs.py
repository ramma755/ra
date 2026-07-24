import json
from pathlib import Path

REPORT = Path("/app/report.json")


def _load():
    return json.loads(REPORT.read_text())


def test_report_exists():
    """The agent must write the report to /app/report.json."""
    assert REPORT.exists(), "no /app/report.json found"


def test_report_is_valid_json_object():
    """report.json must contain a single JSON object."""
    assert isinstance(_load(), dict), "report.json is not a JSON object"


def test_required_keys_present():
    """report.json must contain total_requests, unique_ips, and top_path."""
    assert {"total_requests", "unique_ips", "top_path"} <= _load().keys()


def test_total_requests_correct():
    """total_requests must equal the number of log entries (6)."""
    assert _load()["total_requests"] == 6


def test_unique_ips_correct():
    """unique_ips must equal the count of distinct client IPs (3)."""
    assert _load()["unique_ips"] == 3


def test_top_path_correct():
    """top_path must be the most-requested path (/index.html)."""
    assert _load()["top_path"] == "/index.html"

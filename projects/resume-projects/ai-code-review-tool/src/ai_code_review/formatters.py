from __future__ import annotations

import json

from ai_code_review.models import Finding
from ai_code_review.reviewer import CRITERIA


def format_plain(findings: list[Finding]) -> str:
    if not findings:
        return "No findings. Review criteria passed."

    return "\n".join(
        f"[{finding.severity.upper()}] {finding.category} "
        f"{finding.file_path}:{finding.line or '-'} - {finding.message}"
        for finding in findings
    )


def format_markdown(findings: list[Finding]) -> str:
    if not findings:
        return "## AI Code Review\n\nNo findings. Review criteria passed."

    lines = [
        "## AI Code Review",
        "",
        "Criteria: " + ", ".join(CRITERIA),
        "",
        "| Severity | Category | Location | Finding |",
        "| --- | --- | --- | --- |",
    ]

    for finding in findings:
        location = f"{finding.file_path}:{finding.line or '-'}"
        lines.append(
            f"| {finding.severity} | {finding.category} | `{location}` | {finding.message} |"
        )

    return "\n".join(lines)


def format_github_comment(findings: list[Finding]) -> str:
    payload = {
        "event": "COMMENT",
        "body": format_markdown(findings),
    }
    return json.dumps(payload, indent=2)

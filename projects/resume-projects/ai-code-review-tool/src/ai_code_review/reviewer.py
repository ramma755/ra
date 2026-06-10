from __future__ import annotations

import ast
import re
from pathlib import Path

from ai_code_review.models import Finding

CRITERIA = [
    "correctness",
    "reliability",
    "maintainability",
    "security",
    "testability",
]


class CodeReviewer:
    def review_path(self, path: Path) -> list[Finding]:
        if path.is_dir():
            findings: list[Finding] = []
            for child in sorted(path.rglob("*.py")):
                findings.extend(self.review_python_file(child))
            return sorted(findings, key=Finding.sort_key)

        if path.suffix == ".diff" or path.suffix == ".patch":
            return self.review_diff(path.read_text())

        if path.suffix == ".py":
            return self.review_python_file(path)

        return [
            Finding(
                severity="low",
                category="maintainability",
                message="Unsupported file type; only Python files and unified diffs are analyzed.",
                file_path=str(path),
            )
        ]

    def review_python_file(self, path: Path) -> list[Finding]:
        source = path.read_text()
        findings = self._review_source_text(source, str(path))

        try:
            tree = ast.parse(source)
        except SyntaxError as error:
            findings.append(
                Finding(
                    severity="high",
                    category="correctness",
                    message=f"Python syntax error: {error.msg}",
                    file_path=str(path),
                    line=error.lineno,
                )
            )
            return sorted(findings, key=Finding.sort_key)

        findings.extend(self._review_ast(tree, str(path)))
        return sorted(findings, key=Finding.sort_key)

    def review_diff(self, diff_text: str) -> list[Finding]:
        findings: list[Finding] = []
        current_file = "diff"
        changed_files: set[str] = set()
        new_line = 0

        for raw_line in diff_text.splitlines():
            if raw_line.startswith("+++ b/"):
                current_file = raw_line.removeprefix("+++ b/")
                changed_files.add(current_file)
                continue

            if raw_line.startswith("@@"):
                new_line = self._parse_hunk_start(raw_line)
                continue

            if raw_line.startswith("+") and not raw_line.startswith("+++"):
                added_line = raw_line[1:]
                findings.extend(self._review_line(added_line, current_file, new_line))
                new_line += 1
            elif not raw_line.startswith("-"):
                new_line += 1

        if not any("test" in file_path.lower() for file_path in changed_files):
            findings.append(
                Finding(
                    severity="medium",
                    category="testability",
                    message="No test file changes were detected in this diff.",
                    file_path=current_file,
                )
            )

        return sorted(findings, key=Finding.sort_key)

    def _review_source_text(self, source: str, file_path: str) -> list[Finding]:
        findings: list[Finding] = []

        for line_number, line in enumerate(source.splitlines(), start=1):
            findings.extend(self._review_line(line, file_path, line_number))

        return findings

    def _review_line(self, line: str, file_path: str, line_number: int) -> list[Finding]:
        findings: list[Finding] = []
        lowered = line.lower()

        if "todo" in lowered or "fixme" in lowered:
            findings.append(
                Finding(
                    severity="low",
                    category="maintainability",
                    message="Resolve TODO/FIXME notes before merging production code.",
                    file_path=file_path,
                    line=line_number,
                )
            )

        if "eval(" in line or "exec(" in line:
            findings.append(
                Finding(
                    severity="high",
                    category="security",
                    message="Avoid eval/exec on untrusted input.",
                    file_path=file_path,
                    line=line_number,
                )
            )

        if "except:" in line:
            findings.append(
                Finding(
                    severity="medium",
                    category="reliability",
                    message="Catch a specific exception instead of using a bare except.",
                    file_path=file_path,
                    line=line_number,
                )
            )

        return findings

    @staticmethod
    def _review_ast(tree: ast.AST, file_path: str) -> list[Finding]:
        findings: list[Finding] = []

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                end_line = getattr(node, "end_lineno", node.lineno)
                function_length = end_line - node.lineno + 1

                if function_length > 50:
                    findings.append(
                        Finding(
                            severity="medium",
                            category="maintainability",
                            message=(
                                f"Function `{node.name}` is {function_length} lines; "
                                "consider splitting it into smaller units."
                            ),
                            file_path=file_path,
                            line=node.lineno,
                        )
                    )

                if not ast.get_docstring(node) and not node.name.startswith("_"):
                    findings.append(
                        Finding(
                            severity="low",
                            category="maintainability",
                            message=f"Public function `{node.name}` is missing a docstring.",
                            file_path=file_path,
                            line=node.lineno,
                        )
                    )

        return findings

    @staticmethod
    def _parse_hunk_start(hunk_header: str) -> int:
        match = re.search(r"\+(\d+)(?:,\d+)?", hunk_header)
        return int(match.group(1)) if match else 0

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Finding:
    severity: str
    category: str
    message: str
    file_path: str
    line: int | None = None

    def sort_key(self) -> tuple[int, str, int]:
        weights = {"high": 0, "medium": 1, "low": 2}
        return (weights.get(self.severity, 3), self.file_path, self.line or 0)

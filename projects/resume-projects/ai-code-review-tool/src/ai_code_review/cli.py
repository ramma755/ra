from __future__ import annotations

import argparse
from pathlib import Path

from ai_code_review.formatters import (
    format_github_comment,
    format_markdown,
    format_plain,
)
from ai_code_review.reviewer import CodeReviewer


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ai-review",
        description="Review Python files or diffs with structured AI-style criteria.",
    )
    parser.add_argument("target", type=Path, help="Python file, directory, or diff to review.")
    parser.add_argument(
        "--format",
        choices=["plain", "markdown", "github-comment"],
        default="plain",
        help="Output format.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    findings = CodeReviewer().review_path(args.target)

    if args.format == "markdown":
        print(format_markdown(findings))
    elif args.format == "github-comment":
        print(format_github_comment(findings))
    else:
        print(format_plain(findings))


if __name__ == "__main__":
    main()

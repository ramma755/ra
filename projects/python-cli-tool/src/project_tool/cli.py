from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="project-tool",
        description="A tiny CLI starter for text utilities.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    stats_parser = subparsers.add_parser("stats", help="Show text statistics.")
    stats_parser.add_argument("text", help="Text to analyze.")

    slug_parser = subparsers.add_parser("slug", help="Create a URL-safe slug.")
    slug_parser.add_argument("text", help="Text to slugify.")

    return parser


def text_stats(text: str) -> dict[str, int]:
    words = [word for word in text.split() if word]
    characters = len(text)
    letters = sum(1 for character in text if character.isalpha())

    return {
        "characters": characters,
        "letters": letters,
        "words": len(words),
    }


def slugify(text: str) -> str:
    normalized = []
    previous_dash = False

    for character in text.lower():
        if character.isalnum():
            normalized.append(character)
            previous_dash = False
        elif not previous_dash:
            normalized.append("-")
            previous_dash = True

    return "".join(normalized).strip("-")


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "stats":
        counts = text_stats(args.text)
        for key, value in counts.items():
            print(f"{key}: {value}")
        return

    if args.command == "slug":
        print(slugify(args.text))
        return

    parser.error(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json

from drone_control.simulator import QuadcopterSimulator, summarize


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="drone-sim",
        description="Run the autonomous drone control system simulation.",
    )
    parser.add_argument("--seconds", type=float, default=8.0)
    parser.add_argument("--target-roll", type=float, default=0.0)
    parser.add_argument("--target-pitch", type=float, default=0.0)
    parser.add_argument("--target-altitude", type=float, default=10.0)
    parser.add_argument("--seed", type=int, default=7)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    simulator = QuadcopterSimulator(seed=args.seed)
    samples = simulator.run(
        seconds=args.seconds,
        target_roll=args.target_roll,
        target_pitch=args.target_pitch,
        target_altitude=args.target_altitude,
    )

    print(json.dumps(summarize(samples), indent=2))


if __name__ == "__main__":
    main()

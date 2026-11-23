"""Score offline, human-annotated analytics pilot results; no API calls."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from analytics.evaluation import evaluate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gold", type=Path)
    parser.add_argument("predictions", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--min-f1", type=float, default=None)
    args = parser.parse_args()
    if args.min_f1 is not None and not 0 <= args.min_f1 <= 1:
        parser.error("--min-f1 must be between 0 and 1")
    try:
        report = evaluate(
            json.loads(args.gold.read_text(encoding="utf-8-sig")),
            json.loads(args.predictions.read_text(encoding="utf-8-sig")),
        )
        f1 = report["labels"]["micro"]["f1"]
        report["passed"] = report["passedStructuralChecks"] and (
            args.min_f1 is None or (f1 is not None and f1 >= args.min_f1)
        )
        output = (
            json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        )
        if args.output:
            args.output.write_text(output, encoding="utf-8")
        else:
            print(output)
        return 0 if report["passed"] else 1
    except (OSError, ValueError) as exc:
        print(f"Evaluation input error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

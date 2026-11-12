#!/usr/bin/env python3
"""Runs the symptom intake over tests/data/intake_cases.json and reports accuracy.

Uses the real language model chosen by INTAKE_PROVIDER, so it needs that
provider's key and model name, and costs a few cents. Run from the ai/ folder:
    python -m training.evaluate_intake
Writes models/intake_eval.json.

Reported per language: exact matches (every symptom right), red-flag recall
(red-flag cases that were flagged), false red flags (non-red-flag cases that
were flagged anyway) and urgent checks raised on non-red-flag cases. Recall is given for the whole system and for the
keyword net alone.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from app.intake import provider
from app.intake.keywords import red_flags_in
from app.intake.service import run_intake
from app.intake.symptoms import RED_FLAGS
from app.schemas import IntakeRequest

AI_DIR = Path(__file__).resolve().parents[1]
CASES = AI_DIR / "tests" / "data" / "intake_cases.json"


def main() -> None:
    config = provider.describe()
    if not config.get("model") or not config.get("keySet"):
        sys.exit(f"The intake provider is not fully configured: {config}. See app/intake/provider.py.")
    cases = json.loads(CASES.read_text())["cases"]
    stats: dict[str, dict] = {}
    failures = []
    for case in cases:
        s = stats.setdefault(case["lang"], {"cases": 0, "exact": 0, "red_cases": 0, "red_caught": 0,
                                            "red_caught_by_keywords": 0, "false_red": 0, "urgent_checks_on_non_red": 0, "model_failures": 0})
        result = run_intake(IntakeRequest(text=case["text"]))
        expected = sorted(case["expect"])
        is_red = any(name in RED_FLAGS for name in expected)
        s["cases"] += 1
        s["exact"] += sorted(result.reported) == expected
        s["model_failures"] += result.extractor != "LLM"
        if is_red:
            s["red_cases"] += 1
            s["red_caught"] += result.red_flag
            s["red_caught_by_keywords"] += bool(red_flags_in(case["text"]))
        else:
            s["false_red"] += result.red_flag
            s["urgent_checks_on_non_red"] += result.needs_urgent_check
        if sorted(result.reported) != expected:
            failures.append({"lang": case["lang"], "text": case["text"], "expected": expected,
                             "got": sorted(result.reported), "extractor": result.extractor})

    report = {"provider": config["provider"], "model": config["model"], "by_language": stats, "mismatches": failures,
              "note": "Small machine-drafted test set; Arabic and Hindi phrases are unreviewed."}
    out = AI_DIR / "models" / "intake_eval.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

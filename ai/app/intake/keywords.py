"""Red-flag phrases, matched without any model.

This is the safety net. If the language model fails or times out, a phrase
found here raises the red flag by itself. If the model answers but does not
confirm the phrase, the hit is reported as disputed and a person must check on
the worker urgently. It is deliberately blunt: it cannot understand "I did not
faint", which is why a disputed hit is a check and not an emergency call.

The Arabic and Hindi phrases were machine-drafted and MUST be reviewed and
extended by native speakers (and Urdu, Bengali and Malayalam added) before a pilot.
"""
from __future__ import annotations

import re
import unicodedata

RED_FLAG_PHRASES: dict[str, list[str]] = {
    "confusion": [
        # English
        "confused", "confusion", "disoriented", "can't think", "cannot think", "don't know where i am",
        "not making sense", "talking nonsense", "slurring",
        # Arabic
        "مشوش", "تشوش", "ارتباك", "مرتبك", "لا أعرف أين أنا", "لا اعرف اين انا", "يهذي",
        # Hindi
        "भ्रम", "उलझन", "होश नहीं", "समझ नहीं आ रहा", "बहकी बातें",
    ],
    "fainting": [
        "fainted", "fainting", "faint", "passed out", "blacked out", "collapsed", "collapse", "unconscious",
        "أغمي", "اغمي", "إغماء", "اغماء", "فقد الوعي", "سقط على الأرض", "فاقد الوعي",
        "बेहोश", "बेहोशी", "गिर गया", "गिर पड़ा", "चक्कर खाकर गिर",
    ],
    "stopped_sweating": [
        "stopped sweating", "not sweating", "no sweat", "can't sweat", "skin is dry and hot", "hot dry skin",
        "توقف العرق", "توقفت عن التعرق", "لا أتعرق", "لا اتعرق", "جلد جاف وساخن",
        "पसीना नहीं आ रहा", "पसीना बंद", "पसीना आना बंद",
    ],
    "vomiting": [
        "vomiting", "vomited", "vomit", "throwing up", "threw up", "puking",
        "أتقيأ", "اتقيأ", "تقيأت", "تقيؤ", "قيء", "استفراغ", "استفرغت",
        "उल्टी", "उल्टियां", "वमन",
    ],
}


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("’", "'")
    return re.sub(r"\s+", " ", text)


def red_flags_in(text: str) -> list[str]:
    """Names of the red flags whose phrases appear in the text, in a stable order."""
    haystack = _normalise(text)
    found = []
    for flag, phrases in RED_FLAG_PHRASES.items():
        for phrase in phrases:
            needle = _normalise(phrase)
            if needle.isascii():
                hit = re.search(rf"(?<![a-z]){re.escape(needle)}(?![a-z])", haystack) is not None
            else:
                hit = needle in haystack
            if hit:
                found.append(flag)
                break
    return found

"""The fixed symptom list. The language model may only fill in these fields."""
from __future__ import annotations

SYMPTOMS = [
    "dizziness",
    "headache",
    "nausea",
    "cramps",
    "heavy_sweating",
    "stopped_sweating",
    "confusion",
    "fainting",
    "vomiting",
    "very_thirsty",
    "weakness",
]

# Signs that need an emergency response. NIOSH warns that a worker can have
# heat stroke while still sweating, so stopped_sweating is one flag among
# several and is never required.
RED_FLAGS = ["confusion", "fainting", "stopped_sweating", "vomiting"]

# JSON Schema the model's answer must follow exactly.
EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {name: {"type": "boolean"} for name in SYMPTOMS},
    "required": SYMPTOMS,
    "additionalProperties": False,
}

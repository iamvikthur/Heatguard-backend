"""Turns a worker's message into the fixed symptom list.

The language model only extracts. It never sets a heat level and never decides
whether to escalate: that is done by the rules, from the fields returned here.
"""
from __future__ import annotations

import base64
import binascii

from pydantic import ValidationError

from app.intake import provider
from app.intake.keywords import red_flags_in
from app.intake.symptoms import RED_FLAGS, SYMPTOMS
from app.schemas import IntakeRequest, IntakeResponse, Symptoms

MAX_TEXT_CHARS = 1000
MAX_AUDIO_BYTES = 5 * 1024 * 1024


class IntakeError(ValueError):
    pass


def _transcript(req: IntakeRequest) -> tuple[str, bool]:
    if req.audio_base64:
        try:
            audio = base64.b64decode(req.audio_base64, validate=True)
        except (binascii.Error, ValueError) as err:
            raise IntakeError("audioBase64 is not valid base64") from err
        if not audio or len(audio) > MAX_AUDIO_BYTES:
            raise IntakeError("the recording is empty or larger than 5 MB")
        return provider.transcribe(audio, req.audio_filename or "checkin.m4a"), True
    if req.text and req.text.strip():
        return req.text.strip()[:MAX_TEXT_CHARS], False
    raise IntakeError("send text or audioBase64")


def run_intake(req: IntakeRequest) -> IntakeResponse:
    """Raises provider.ProviderError only when a recording cannot be transcribed."""
    text, from_audio = _transcript(req)
    keyword_flags = red_flags_in(text)

    extractor, model_error = "LLM", None
    try:
        symptoms = Symptoms.model_validate(provider.extract_symptoms(text))
    except (provider.ProviderError, ValidationError) as err:
        # The model is unavailable or its answer does not fit the schema: fall
        # back to the keyword net alone.
        symptoms = Symptoms()
        extractor = "KEYWORD"
        model_error = str(err) if isinstance(err, provider.ProviderError) else "the answer did not match the schema"

    values = symptoms.model_dump()
    if extractor == "KEYWORD":
        # No usable model answer: the keyword net decides alone.
        for flag in keyword_flags:
            values[flag] = True
        disputed: list[str] = []
    else:
        # The model answered. A keyword hit it did not confirm is usually a
        # negation ("I have not vomited"), but it could be a miss, so it is
        # passed on for an urgent in-person check instead of being dropped.
        disputed = [flag for flag in keyword_flags if not values[flag]]
    reported = [name for name in SYMPTOMS if values[name]]
    red_flags = [name for name in RED_FLAGS if values[name]]

    return IntakeResponse(
        transcript=text,
        from_audio=from_audio,
        symptoms=Symptoms(**values),
        reported=reported,
        red_flags=red_flags,
        red_flag=bool(red_flags),
        keyword_flags=keyword_flags,
        disputed_flags=disputed,
        needs_urgent_check=bool(disputed) and not red_flags,
        extractor=extractor,
        model_error=model_error,
        # Nothing understood and the model was not available: ask the worker to tap instead.
        needs_tap_checkin=extractor == "KEYWORD" and not reported,
    )

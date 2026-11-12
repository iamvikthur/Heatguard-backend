import base64

import pytest
from fastapi.testclient import TestClient

from app.intake import provider
from app.intake.keywords import red_flags_in
from app.intake.symptoms import SYMPTOMS
from app.main import app

client = TestClient(app)


def answer(**true_fields) -> dict:
    return {name: name in true_fields for name in SYMPTOMS}


@pytest.fixture
def model(monkeypatch):
    def install(result=None, error=None):
        def fake(text):
            if error:
                raise error
            return result
        monkeypatch.setattr(provider, "extract_symptoms", fake)
    return install


def test_model_answer_is_used(model):
    model(answer(dizziness=True, headache=True))
    data = client.post("/intake", json={"text": "my head hurts and I feel dizzy"}).json()
    assert data["extractor"] == "LLM"
    assert data["reported"] == ["dizziness", "headache"]
    assert data["redFlag"] is False
    assert data["needsTapCheckin"] is False


def test_model_red_flag_is_reported(model):
    model(answer(confusion=True))
    data = client.post("/intake", json={"text": "he does not know where he is"}).json()
    assert data["redFlag"] is True
    assert data["redFlags"] == ["confusion"]


def test_keyword_hit_the_model_denies_becomes_an_urgent_check(model):
    model(answer(nausea=True))
    data = client.post("/intake", json={"text": "I feel sick but I have not vomited"}).json()
    assert data["extractor"] == "LLM"
    assert data["redFlag"] is False
    assert data["keywordFlags"] == ["vomiting"]
    assert data["disputedFlags"] == ["vomiting"]
    assert data["needsUrgentCheck"] is True
    assert data["reported"] == ["nausea"]


def test_no_urgent_check_when_model_and_keywords_agree(model):
    model(answer(vomiting=True))
    data = client.post("/intake", json={"text": "I vomited twice"}).json()
    assert data["redFlag"] is True
    assert data["disputedFlags"] == []
    assert data["needsUrgentCheck"] is False


@pytest.mark.parametrize("failure", [
    provider.ProviderError("timeout"),
    None,  # handled below: an answer that does not fit the schema
])
def test_keywords_still_catch_red_flags_when_the_model_fails(model, failure):
    if failure:
        model(error=failure)
    else:
        model({"dizziness": "yes", "made_up_field": True})
    data = client.post("/intake", json={"text": "I stopped sweating and feel confused"}).json()
    assert data["extractor"] == "KEYWORD"
    assert data["redFlag"] is True
    assert set(data["redFlags"]) == {"confusion", "stopped_sweating"}
    assert data["modelError"]


def test_model_cannot_add_fields_or_non_booleans(model):
    model({**answer(), "level": "GREEN"})
    data = client.post("/intake", json={"text": "I feel fine"}).json()
    assert data["extractor"] == "KEYWORD"
    assert data["reported"] == []


def test_asks_for_a_tap_checkin_when_nothing_could_be_understood(model):
    model(error=provider.ProviderError("down"))
    data = client.post("/intake", json={"text": "not feeling good"}).json()
    assert data["needsTapCheckin"] is True
    assert data["redFlag"] is False


def test_recording_is_transcribed_first(model, monkeypatch):
    model(answer(weakness=True))
    monkeypatch.setattr(provider, "transcribe", lambda audio, filename: "I feel very weak")
    body = {"audioBase64": base64.b64encode(b"fake audio").decode(), "audioFilename": "note.m4a"}
    data = client.post("/intake", json=body).json()
    assert data["fromAudio"] is True
    assert data["transcript"] == "I feel very weak"
    assert data["reported"] == ["weakness"]


def test_failed_transcription_is_reported_not_guessed(monkeypatch):
    def broken(audio, filename):
        raise provider.ProviderError("transcription failed")
    monkeypatch.setattr(provider, "transcribe", broken)
    res = client.post("/intake", json={"audioBase64": base64.b64encode(b"x").decode()})
    assert res.status_code == 502


def test_rejects_empty_and_malformed_input():
    assert client.post("/intake", json={}).status_code == 422
    assert client.post("/intake", json={"text": "   "}).status_code == 422
    assert client.post("/intake", json={"audioBase64": "not base64!"}).status_code == 422


def test_missing_key_falls_back_to_keywords(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_INTAKE_MODEL", "some-model")
    data = client.post("/intake", json={"text": "I passed out for a moment"}).json()
    assert data["extractor"] == "KEYWORD"
    assert data["redFlags"] == ["fainting"]


@pytest.mark.parametrize("text, expected", [
    ("I feel confused and disoriented", ["confusion"]),
    ("He collapsed near the mixer", ["fainting"]),
    ("I have stopped sweating", ["stopped_sweating"]),
    ("been throwing up since ten", ["vomiting"]),
    ("أشعر بدوار وتقيأت مرتين", ["vomiting"]),
    ("أغمي عليه قبل قليل", ["fainting"]),
    ("मुझे उल्टी हो रही है", ["vomiting"]),
    ("वह बेहोश हो गया", ["fainting"]),
    ("पसीना नहीं आ रहा है और उलझन हो रही है", ["confusion", "stopped_sweating"]),
    ("I am tired and thirsty", []),
    ("the faintest breeze would help", []),
])
def test_red_flag_keywords(text, expected):
    assert red_flags_in(text) == expected


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


@pytest.fixture
def http(monkeypatch):
    calls = []

    def install(payload):
        def fake_post(url, **kwargs):
            calls.append({"url": url, **kwargs})
            return FakeResponse(payload)
        monkeypatch.setattr(provider.httpx, "post", fake_post)
        return calls
    return install


def test_openai_request_and_answer(http, monkeypatch):
    monkeypatch.setenv("INTAKE_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_INTAKE_MODEL", "some-openai-model")
    import json as _json
    calls = http({"choices": [{"message": {"content": _json.dumps(answer(headache=True))}}]})
    data = client.post("/intake", json={"text": "my head hurts"}).json()
    assert data["extractor"] == "LLM" and data["reported"] == ["headache"]
    call = calls[0]
    assert call["url"].endswith("/chat/completions")
    assert call["headers"]["Authorization"] == "Bearer test-key"
    assert call["json"]["model"] == "some-openai-model"
    assert call["json"]["response_format"]["json_schema"]["strict"] is True
    assert call["json"]["messages"][-1] == {"role": "user", "content": "my head hurts"}


def test_anthropic_request_and_answer(http, monkeypatch):
    monkeypatch.setenv("INTAKE_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_INTAKE_MODEL", "some-claude-model")
    import json as _json
    calls = http({"stop_reason": "end_turn", "content": [{"type": "text", "text": _json.dumps(answer(cramps=True))}]})
    data = client.post("/intake", json={"text": "leg cramps"}).json()
    assert data["extractor"] == "LLM" and data["reported"] == ["cramps"]
    call = calls[0]
    assert call["url"].endswith("/messages")
    assert call["headers"] == {"x-api-key": "test-key", "anthropic-version": "2023-06-01"}
    assert call["json"]["model"] == "some-claude-model"
    assert call["json"]["output_config"]["format"]["type"] == "json_schema"
    assert call["json"]["system"] and call["json"]["max_tokens"] > 0


def test_anthropic_refusal_or_cut_off_falls_back_to_keywords(http, monkeypatch):
    monkeypatch.setenv("INTAKE_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_INTAKE_MODEL", "some-claude-model")
    http({"stop_reason": "max_tokens", "content": [{"type": "text", "text": "{"}]})
    data = client.post("/intake", json={"text": "I passed out"}).json()
    assert data["extractor"] == "KEYWORD" and data["redFlags"] == ["fainting"]


def test_unknown_provider_falls_back_to_keywords(monkeypatch):
    monkeypatch.setenv("INTAKE_PROVIDER", "something-else")
    data = client.post("/intake", json={"text": "I vomited"}).json()
    assert data["extractor"] == "KEYWORD" and data["redFlag"] is True
    assert "INTAKE_PROVIDER" in data["modelError"]


def test_the_messages_sent_to_both_providers_carry_only_the_workers_words(http, monkeypatch):
    import json as _json
    for name, payload in (
        ("openai", {"choices": [{"message": {"content": _json.dumps(answer())}}]}),
        ("anthropic", {"stop_reason": "end_turn", "content": [{"type": "text", "text": _json.dumps(answer())}]}),
    ):
        monkeypatch.setenv("INTAKE_PROVIDER", name)
        monkeypatch.setenv(f"{name.upper()}_API_KEY", "test-key")
        monkeypatch.setenv(f"{name.upper()}_INTAKE_MODEL", "m")
        calls = http(payload)
        client.post("/intake", json={"text": "tired"})
        user_messages = [m["content"] for m in calls[0]["json"]["messages"] if m["role"] == "user"]
        assert user_messages == ["tired"]


def test_voice_needs_an_openai_key_even_with_claude(monkeypatch):
    monkeypatch.setenv("INTAKE_PROVIDER", "anthropic")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    res = client.post("/intake", json={"audioBase64": base64.b64encode(b"x").decode()})
    assert res.status_code == 502
    assert "OPENAI_API_KEY" in res.json()["detail"]


def test_health_reports_the_provider_without_the_key(monkeypatch):
    monkeypatch.setenv("INTAKE_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "secret-value")
    monkeypatch.setenv("ANTHROPIC_INTAKE_MODEL", "some-claude-model")
    health = client.get("/health").json()
    assert health["models"]["intake"]["provider"] == "anthropic"
    assert health["models"]["intake"]["keySet"] is True
    assert "secret-value" not in str(health)

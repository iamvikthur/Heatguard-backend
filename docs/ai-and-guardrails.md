# AI components and guardrails

HeatGuard decides work and rest from published formulas, not from a model. The NIOSH 2016 limits encode decades of physiology; two summers of weather data cannot improve on them, and a learned limit could not be checked or explained to a supervisor. So the schedule, the levels and the alerts are deterministic code (`ai/app/rules/`, tested and documented with sources in [risk-model.md](risk-model.md)).

AI is used where rules cannot do the job:

| | Symptom intake | Forecast correction |
| --- | --- | --- |
| Job | Understand a worker's own words in English, Arabic or Hindi | Correct tomorrow's forecast for the forecast's recent error at the site |
| Model | Language model (OpenAI or Claude, set by `INTAKE_PROVIDER`); speech-to-text through OpenAI | Gradient-boosted quantile regression (scikit-learn), refitted per request on the last 45 days |
| Decides | Which of eleven fixed symptoms the message reports | Nothing on the day. It feeds the planning view only. |
| Never decides | A level, a schedule, or whether to call for help on its own | Any live work/rest decision |

## 1. Symptom intake

Code: `ai/app/intake/`. Flow: text, or audio transcribed to text → the model fills a fixed schema → a keyword net checks the result → the backend applies the outcome.

**What the model may say.** Only `true` or `false` for each of eleven symptoms (dizziness, headache, nausea, cramps, heavy sweating, stopped sweating, confusion, fainting, vomiting, very thirsty, weakness). The answer must match a strict JSON schema (structured outputs on both providers) and is validated again on arrival. It has no field for a level, a diagnosis or advice, so it cannot produce one.

**What each symptom does.** Rules, not the model, turn symptoms into action. Any symptom makes the worker's schedule one step stricter and puts them on the supervisor's "needs check" list. Any of the four red flags (confusion, fainting, stopped sweating, vomiting) starts the emergency messages: stop work and get cool for the worker; go to them, cool them and call 998 for the supervisor. Following NIOSH, "stopped sweating" is one red flag among several and is never required: continued sweating does not rule out heat stroke.

**The keyword net.** A list of red-flag phrases per language (`ai/app/intake/keywords.py`) runs on every message, alongside the model:

| Model | Keyword net | Outcome |
| --- | --- | --- |
| Reports a red flag | any | Emergency |
| Fails, times out, or answers outside the schema | Finds a red flag | Emergency |
| Reports no red flag | Finds a red-flag phrase | Urgent in-person check, not an emergency |
| Fails | Finds nothing | Worker is asked to tap their symptoms |

The third row is the important one. Keyword matching cannot read negation, so "I have a headache but have not vomited" matches "vomited". On its own the net would call an ambulance for a worker who said they were fine in that respect. The model reads the sentence correctly; but because a disagreement could also be the model missing something, the worker is still seen in person, urgently. Neither component can quietly overrule the other. This exact case was tested on the live deployment in Hindi.

**Privacy.** Only the worker's words go to the model provider: no name, phone number, worker id, site or crew. Workers are pseudonymous in the database. Supervisors are told that a worker needs checking, not what they reported, except in an emergency, where the supervisor needs the symptoms to act.

**Consent.** The backend refuses a check-in for a worker who has not consented to symptom check-ins, or has withdrawn. Workers can withdraw from their own page.

**Evaluation.** `python -m training.evaluate_intake` runs 33 test messages (13 English, 10 Arabic, 10 Hindi), including negations and red flags, against the configured model and reports exact matches, red-flag recall, false red flags and urgent checks. Results: [metrics.md](metrics.md). The Arabic and Hindi phrases and keyword lists were machine-drafted and have not been reviewed by native speakers; that review is the first task before any pilot.

**Provider choice.** `INTAKE_PROVIDER=openai` or `anthropic`, with the model name in the environment. The service reports which provider and model it uses at `/health`, never the key.

## 2. Forecast correction (planning only)

Code: `ai/app/forecast/`. Evaluation and full numbers: [metrics.md](metrics.md).

**What happened.** A fixed model trained on 2024 and validated on 2025 looked like a 21% accuracy gain. On held-out summer 2026 it made the forecast 42% worse, because the upstream forecast had stopped being biased and the model kept correcting a bias that was gone. That result is reported, not hidden, and the fixed model is not used.

**What replaced it.** An adaptive version that:

1. learns only from the last 45 days, so it follows changes in the forecast source;
2. aims high on purpose (0.8 quantile), because under-forecasting heat is the dangerous error;
3. **switches itself off** unless the forecast's average error over those 45 days is at least 0.4 °C, and uses the raw forecast unchanged when off.

In a walk-forward test it was 9% and 15% more accurate in 2024 and 2025, when the forecast was biased, and identical to the raw forecast in 2026, when it was not: it stayed off all summer and did no harm. On the live deployment today it is off (recent bias −0.06 °C).

**Where it is used.** Only the planning view, which shows tomorrow's schedule from the raw forecast and from the corrected forecast side by side, with a note saying whether the correction is on. The corrected value can be lower than the raw one when the forecast has been running hot, which is why both are always shown. On the day, every work/rest decision comes from the live forecast, which the model is not trained for and never touches.

**How far to trust it.** The window, quantile and threshold were chosen after seeing all three summers, so no untouched test remains. Two nearby sites, one forecast provider. It is evidence the approach is sound, not proof of a gain.

## What the AI cannot break

- **The model is down:** check-ins fall back to the keyword net and then to tapping; the planning view falls back to the raw forecast. Live schedules never depend on either model.
- **The weather API is down:** the last stored forecast is used and every level is raised one step, marked as fallback on the dashboard.
- **The model answers nonsense:** it fails schema validation and is treated as down.
- **The model misses a red flag the worker wrote:** the keyword net catches the phrase and the worker is checked urgently in person (row 3), or the worker can tap the symptom directly.
- **The model misses a red flag in words the keyword list does not contain:** not caught. This is the residual risk, and why the keyword lists need native-speaker review and the worker page always offers the symptom buttons.

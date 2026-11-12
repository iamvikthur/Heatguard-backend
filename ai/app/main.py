from __future__ import annotations

from fastapi import FastAPI, HTTPException

from app.rules import limits
from app.rules.wbgt import estimate_shade_wbgt_c, estimate_wbgt_c
from app.forecast import service as forecast
from app.forecast import plan as planning
from app.intake import provider as intake_provider
from app.intake import service as intake
from app.schemas import AssessRequest, AssessResponse, ForecastRequest, ForecastResponse, IntakeRequest, IntakeResponse, PlanRequest, PlanResponse

app = FastAPI(title="HeatGuard AI service", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "models": {"forecast": forecast.model_version(), "intake": intake_provider.describe()}}


@app.post("/assess", response_model=AssessResponse, response_model_by_alias=True)
def assess(req: AssessRequest) -> AssessResponse:
    try:
        estimated = estimate_wbgt_c(req.weather)
        wbgt = req.wbgt_c if req.wbgt_c is not None else estimated
        if req.rest_wbgt_c is not None:
            rest_wbgt = req.rest_wbgt_c
        elif req.rest_in_shade:
            # Shade removes the same amount of heat whether WBGT was estimated or supplied.
            rest_wbgt = wbgt - (estimated - estimate_shade_wbgt_c(req.weather))
        else:
            rest_wbgt = wbgt
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err

    adj = req.clothing_adj_c
    effective = wbgt + adj
    limit = limits.wbgt_limit_c(req.metabolic_watts, req.acclimatized)
    work_min = limits.work_minutes(effective, req.metabolic_watts, req.acclimatized, rest_wbgt + adj)
    work_min = max(0, work_min - limits.WORK_STEP_MIN * req.stricter_steps)
    work_min_sun = limits.work_minutes(effective, req.metabolic_watts, req.acclimatized)
    level = limits.classify(effective, limit, work_min)
    if req.fallback:
        level = limits.raise_level(level)
    return AssessResponse(
        wbgt_c=round(wbgt, 2),
        wbgt_effective_c=round(effective, 2),
        limit_c=round(limit, 2),
        margin_c=round(effective - limit, 2),
        level=level,
        work_min=work_min,
        rest_min=60 - work_min,
        rest_wbgt_c=round(rest_wbgt, 2),
        work_min_rest_in_sun=work_min_sun,
        action=limits.ACTIONS[level],
    )


@app.post("/forecast", response_model=ForecastResponse, response_model_by_alias=True)
def correct_forecast(req: ForecastRequest) -> ForecastResponse:
    """Corrects a 24-hour-ahead forecast. Not meant for same-day forecasts."""
    try:
        version, hours = forecast.correct(req.hours)
    except forecast.ModelNotTrained as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    return ForecastResponse(model_version=version, hours=hours)


@app.post("/plan", response_model=PlanResponse, response_model_by_alias=True)
def plan(req: PlanRequest) -> PlanResponse:
    """Planning estimate for a coming day from its 24-hour-ahead forecast and recent history.

    For planning only. Work/rest decisions on the day come from /assess on the live forecast.
    """
    try:
        return planning.make_plan(req)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err


@app.post("/intake", response_model=IntakeResponse, response_model_by_alias=True)
def symptom_intake(req: IntakeRequest) -> IntakeResponse:
    """Extracts the fixed symptom list from a worker's message or recording.

    The model only extracts. Red-flag keywords are applied even if the model fails.
    """
    try:
        return intake.run_intake(req)
    except intake.IntakeError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except intake_provider.ProviderError as err:
        # Only reached when a recording could not be transcribed: there is no text to fall back on.
        raise HTTPException(status_code=502, detail=str(err)) from err

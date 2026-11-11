from __future__ import annotations

from fastapi import FastAPI, HTTPException

from app.rules import limits
from app.rules.wbgt import estimate_shade_wbgt_c, estimate_wbgt_c
from app.schemas import AssessRequest, AssessResponse

app = FastAPI(title="HeatGuard AI service", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "models": {"forecast": None, "intake": None}}


@app.post("/assess", response_model=AssessResponse, response_model_by_alias=True)
def assess(req: AssessRequest) -> AssessResponse:
    try:
        wbgt = req.wbgt_c if req.wbgt_c is not None else estimate_wbgt_c(req.weather)
        if req.rest_wbgt_c is not None:
            rest_wbgt = req.rest_wbgt_c
        elif req.rest_in_shade and req.wbgt_c is None:
            rest_wbgt = estimate_shade_wbgt_c(req.weather)
        else:
            rest_wbgt = wbgt
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err

    adj = req.clothing_adj_c
    effective = wbgt + adj
    limit = limits.wbgt_limit_c(req.metabolic_watts, req.acclimatized)
    work_min = limits.work_minutes(effective, req.metabolic_watts, req.acclimatized, rest_wbgt + adj)
    work_min_sun = limits.work_minutes(effective, req.metabolic_watts, req.acclimatized)
    level = limits.classify(effective, limit, work_min)
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

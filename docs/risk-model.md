# HeatGuard risk model

How `ai/app/rules/` turns weather into a heat level and a work/rest schedule, where each number comes from, and what has and has not been verified. Last updated 11 Nov 2026.

HeatGuard is a screening and planning aid. It is not a diagnosis, and it does not replace an on-site WBGT meter.

## 1. WBGT from weather

| Item | Choice | Source |
| --- | --- | --- |
| Index | Outdoor WBGT = 0.7 Tnwb + 0.2 Tg + 0.1 Tdb | OSHA Technical Manual, Section III Chapter 4 |
| Model | Liljegren et al. (2008) | The model behind the Argonne calculator that the OSHA Technical Manual names for use when no WBGT meter is available |
| Implementation | `thermofeel.calculate_wbgt_liljegren` (ECMWF thermofeel 2.3) | Library docstring; not re-implemented |
| Sun position | `astral` | Used only for the cosine of the solar zenith angle |

Inputs: air temperature, relative humidity, 10 m wind speed, global and direct horizontal radiation, optional surface pressure, time and coordinates.

Assumptions:
- Radiation is the mean over the hour ending at the timestamp (Open-Meteo convention), so the sun position is taken 30 minutes earlier.
- Missing direct radiation: 65% of global radiation is assumed direct.
- Missing pressure: 1013.25 hPa.
- The worker is in the open. Shade, hot surfaces, enclosed spaces and machinery heat are not modelled.

Check performed: all 744 hours of July 2025 at the Mussafah site computed without failure. WBGT ranged from 22.7 to 38.8 C (median 30.6 C) against a peak air temperature of 48.6 C. Tests cover direction of effect for sun, humidity and wind, plus a pinned reference value. **Not done:** comparison against a WBGT meter or against the Argonne calculator on the same inputs.

## 2. Exposure limits

| Worker | Equation (M = hourly average metabolic rate in watts) | Status |
| --- | --- | --- |
| Acclimatized | limit = 56.7 - 11.5 log10(M) | Matches the ACGIH TLV form quoted in secondary sources. Gives 27.5 C at 348.9 W; the NIOSH 2016-106 worked example gives 27.8 C. |
| Unacclimatized | limit = 59.9 - 14.1 log10(M) | Secondary sources quote the ACGIH action limit with 60.0. Gives 24.0 C at 348.9 W; the NIOSH worked example gives 25 C. **The 59.9 constant was not found in text we could read** (in the NIOSH PDF the equations sit inside Figures 8-1 and 8-2). |

Both equations are stricter than the NIOSH worked example, so any error is on the safe side. A published comparison notes that the NIOSH equations and figures do not agree exactly. To do: read Figures 8-1 and 8-2 in the PDF and confirm both constants.

The limits apply to healthy workers in ordinary single-layer work clothing, as one-hour time-weighted averages (NIOSH 2016-106, Section 1).

## 3. Workload

| Class | Watts | Examples |
| --- | --- | --- |
| Rest | 115 | sitting |
| Light | 180 | standing watch, slow walking |
| Moderate | 300 | general carpentry, hand tools, normal walking |
| Heavy | 415 | carrying loads, shovelling, mixing cement, drilling concrete |
| Very heavy | 520 | intense shovelling, stacking concrete, masonry |

Source: OSHA workload table (osha.gov/heat-exposure/hazards), which assumes a 70 kg worker. Verified.

## 4. Clothing adjustment

Added to WBGT to give effective WBGT. Source: NIOSH 2016-106 Table 3-2 (2006 column, adapted from ACGIH). Verified.

| Clothing | Add (C) |
| --- | --- |
| Work clothing | 0 |
| Cloth coveralls | 0 |
| Spunbound melt-blown synthetic (SMS) coveralls | 0.5 |
| Polyolefin coveralls | 1 |
| Double-layer cloth clothing | 3 |
| Limited-use vapor-barrier coveralls | 11 |

## 5. Work and rest minutes

Method: the hourly time-weighted average used by NIOSH and ACGIH, applied to both WBGT and metabolic rate. For each candidate schedule (60, 45, 30 or 15 minutes of work, matching the curves in NIOSH Figures 8-1 and 8-2), HeatGuard averages the work and rest WBGT and the work and rest (115 W) metabolic rates over the hour, and picks the longest work time whose averages stay within the limit.

Where rest is taken changes the answer:

| Rest area | WBGT used for rest | How to request it |
| --- | --- | --- |
| Shade (default) | Liljegren model with the direct beam removed; diffuse light, air temperature, humidity and wind unchanged | `restInShade: true` |
| Open sun | Same as work | `restInShade: false` |
| Cooled cabin or room | A measured value for that space | `restWbgtC` |

The response also returns `workMinRestInSun`, so the dashboard can show what the rest area buys.

Result on the 2025 Mussafah data, 06:00 to 14:00 shift hours, acclimatized workers (hours out of 248 in July, 240 in September) with zero permitted work minutes:

| Month, workload | Rest in sun | Rest in shade | Rest at 22 C WBGT |
| --- | --- | --- | --- |
| July, light | 123 | 67 | 0 |
| July, heavy | 168 | 141 | 0 |
| September, heavy | 148 | 115 | 0 |

Shade lowers WBGT by about 1.5 to 1.9 C on average, because the air in the shade is just as hot. In peak summer shade alone is not enough for heavy work; a cooled rest area is. The 22 C figure is an illustration, not a measurement: a pilot site must measure its own rest area.

Not modelled: shaded work areas, misting or fans, cooling vests, and the time needed to walk to the rest area.

## 6. Levels

HeatGuard's own labels, not NIOSH's.

| Level | Meaning |
| --- | --- |
| GREEN | 60 minutes of work, more than 2 C below the limit |
| YELLOW | 60 minutes of work, within 2 C of the limit |
| ORANGE | 30 or 45 minutes of work per hour |
| RED | 15 minutes or none |

Individual uplift: any reported symptom raises that worker one level; a red-flag symptom sets RED and escalates. Fallback mode (missing weather or model) raises one level.

## 7. Acclimatization

Source: NIOSH 2016-106 Table 4-1 and Section 4.1.5. Verified.

- New workers: at most 20% of usual hot-work duration on day 1, then at most 20% more each day.
- Experienced workers: 50%, 60%, 80%, 100% over days 1 to 4.
- Full acclimatization takes 7 to 14 days. A week or more away loses much of it; it usually returns in 2 to 3 days.

HeatGuard rule: treat a worker as unacclimatized for the first 14 days on site and after 7 or more days away. The stepped daily percentages are not implemented.

## 8. Red flags

NIOSH describes heat stroke as a medical emergency with central nervous system signs: loss of consciousness, often preceded by vertigo, nausea, headache, confusion or bizarre behaviour. It also warns that continued sweating does not rule heat stroke out. So "stopped sweating" is one red flag among several and is never required. Emergency response: call for help at once and cool the worker.

## Sources

- NIOSH (2016). Criteria for a Recommended Standard: Occupational Exposure to Heat and Hot Environments. Publication 2016-106. https://www.cdc.gov/niosh/docs/2016-106/
- OSHA Technical Manual, Section III, Chapter 4, Heat Stress. https://www.osha.gov/otm/section-3-health-hazards/chapter-4
- OSHA, Heat Hazard Recognition (workload table). https://www.osha.gov/heat-exposure/hazards
- Liljegren et al. (2008). https://doi.org/10.1080/15459620802310770
- ECMWF thermofeel. https://github.com/ecmwf/thermofeel

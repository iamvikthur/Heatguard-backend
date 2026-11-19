# Governance: roles, consent, privacy and audit

HeatGuard handles health information about workers who may not feel free to refuse their employer. The design aims to collect little, show each person only what they need to act, and record who looked.

## Who sees what

| Role | Can see | Can do |
| --- | --- | --- |
| Worker (personal link) | Their own schedule, messages and consent settings | Check in; grant or withdraw consent |
| Supervisor | Their own crews: levels, schedules, which workers need checking | Open a worker's page, check in on their behalf, acknowledge alerts, issue or revoke a worker's link |
| HSE manager | Every site and crew in the organization | Everything a supervisor can, plus run an assessment now and replay past days |
| Admin | As HSE | Also run assessments for all sites at once |

Access is checked on the server for every request, by organization and, for supervisors, by crew (`backend/src/auth/access.service.ts`). A supervisor asking for another crew's worker gets "not found", not the data.

**Symptoms stay with the worker.** A supervisor is told that a worker needs checking, not which symptoms they reported. The exception is an emergency (a red flag), when the supervisor needs to know what to look for. The individual schedule a supervisor sees shows the reason category (new to the heat, recent symptoms), not the symptoms.

## Identity and data minimization

- Workers are stored under a pseudonym (`W-036`) with a language and an acclimatization date. No legal name is stored. A phone number field exists for future SMS and is empty in the demo.
- Only the worker's own words go to the language-model provider: no name, phone number, worker id, site or crew.
- The worker page stores nothing in the browser. The link is the only credential.

## Consent

Two separate consents per worker, each recorded with when it was granted and withdrawn (`Consent` table):

| Scope | Covers | Without it |
| --- | --- | --- |
| Symptom check-ins | Sending how they feel and sharing the "needs check" signal with the supervisor | Check-ins are refused. The worker still gets the crew schedule and alerts. |
| Wearable heart rate | Reading a wearable's heart rate | Nothing is collected. (The wearable feed is design only in this prototype.) |

Withdrawing takes effect immediately and can be done by the worker from their own page. Heat alerts and schedules are not consent-based: they are workplace safety information every crew member receives.

## Worker sign-in links

A supervisor issues a link per worker. It opens only that worker's own page and their three self-service routes; staff routes refuse it, and staff tokens are refused on worker routes. It expires after 30 days. Issuing a new link or pressing "Revoke all links" makes every earlier link stop working at once, and a worker marked inactive is cut off too.

The link is a bearer credential: anyone holding it can act as that worker. That is acceptable for a demo and not for a pilot, which should add a one-time code by SMS.

## Audit log

Every read or change of an individual worker's data is written to `AuditLog` with who, what, when and which worker. Actions recorded:

- Staff: `READ_WORKER_TODAY`, `READ_WORKER_ALERTS`, `CHECKIN_WORKER`, `ESCALATE_WORKER`, `ACK_ALERT`, `GRANT_CONSENT`, `WITHDRAW_CONSENT`, `ISSUE_WORKER_LINK`, `REVOKE_WORKER_LINK`
- Workers through their link: `CHECKIN_SELF`, `GRANT_CONSENT_SELF`, `WITHDRAW_CONSENT_SELF`, recorded with no staff actor and marked `via: worker-link`

The log records the action taken (for example, which response a check-in produced), not the symptoms. There is no screen for the log yet; an HSE view and an export are pilot work.

## Retention (policy, not yet enforced)

The prototype keeps everything. The intended policy for a pilot, to be enforced by a nightly job:

| Data | Keep for | Then |
| --- | --- | --- |
| Check-in transcript (the worker's words) | 30 days | Delete the text; keep the symptom list |
| Check-ins, alerts, worker risks | End of the summer season plus 1 year | Delete |
| Risk assessments and weather | 3 years | Keep for evaluation, contain no personal data |
| Audit log | 3 years | Delete |
| A worker who leaves | 90 days after the last shift | Delete the worker and everything linked to them |

These periods are a proposal for the employer's data protection officer to set against UAE law (Federal Decree-Law 45 of 2021 on personal data protection, and any free-zone rules that apply to the site). They have not had legal review.

## Not a medical device

HeatGuard applies occupational exposure limits and routes reported symptoms to a person. It does not diagnose. The emergency instruction is to stop work, cool the worker and call 998; every other symptom leads to a supervisor seeing the worker in person.

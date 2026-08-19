# Fantasy OS — Pilot Success Criteria (Phase V6.0)

**Purpose:** define what a *successful* enterprise pilot looks like, in terms that can be **observed
during the pilot** — not invented metrics. Each criterion has a plain observation method. A pilot passes
when the "must-pass" criteria are met; the "signal" criteria inform the expansion conversation.

> These are evaluation criteria for a structured pilot, not product KPIs and not analytics targets. They
> describe what a customer's team should be able to *do and observe*, using the product as built.

---

## Must-pass criteria

| # | Criterion | How it is observed |
| --- | --- | --- |
| 1 | **Onboarding completes without engineering intervention** | The customer's implementation team brands the hubs (tenant config + validator passes) and connects at least one provider league using only the Onboarding Guide. |
| 2 | **Branding meets customer expectations** | The customer confirms the hubs render under their product name, hub labels, brand color/font, and section visibility; no first-party ("AllFantasy") string appears. |
| 3 | **All seven Operating Systems render populated** | With a connected account, each of the seven workspaces displays real data (or an honest, clearly-labeled "not available" state — never a blank or an error). |
| 4 | **Provider abstraction is invisible** | No provider identifier (Sleeper/ESPN/Yahoo/…) appears anywhere on the executive surface during the walkthrough. |
| 5 | **Executive users understand the dashboard hierarchy** | An executive user, unprompted, can state what each Operating System is *for* (its one question) after the Demonstration Script — and can find the Platform summary as the top-level triage. |
| 6 | **Recommendations are actionable** | For each workspace shown, the user can name the recommended next action and where they would go to take it (one-home-per-recommendation holds — no duplicate/conflicting homes). |

## Signal criteria (inform expansion, not pass/fail)

| # | Criterion | How it is observed |
| --- | --- | --- |
| 7 | **~10-second executive read** | An executive can summarize their season/portfolio/league state within roughly ten seconds of opening the relevant flagship, without assistance. |
| 8 | **Truthfulness is understood as a feature** | When a deferred capability shows a "not available" state, the customer reads it as trustworthy (no fabricated data), not as a gap. |
| 9 | **Deferred capabilities have a credible path** | Using the Capability Boundary Matrix, the customer's technical reviewer agrees each deferred item can be added without redesigning the executive layer. |
| 10 | **Consistency across workspaces** | The customer observes that all seven workspaces share one visual/decision language (calm, executive, same status vocabulary), not seven different tools. |

## What is explicitly *not* a pilot criterion

- Engagement/retention lift, revenue, or any outcome that depends on end-user behavior over time — out of
  scope for a structured product pilot and not measurable within it.
- Any capability listed in the Known Capability Boundary Matrix as deferred (FAAB strategy, draft value
  curves, platform history, expanded trade intelligence, playoff outlook) — these are not expected in the
  pilot and their absence is not a failure.
- Backend/tenancy features that this phase deliberately did not build (per-request multi-tenancy, hosted
  brand store).

## Pilot exit

A pilot is **successful** when criteria 1–6 are met and the customer's evaluation team can, unaided:
understand what Fantasy OS is, see it under their brand, connect a provider, experience all seven
Operating Systems, and articulate the value of each — with no architectural change requested to get there.

# Fantasy OS — Pilot Product Gap Analysis (FRAMEWORK)

> **This is a framework, not filled analysis.** Use it to categorize and prioritize the request registers
> collected across real pilot Observation Logs. No requests are pre-listed — they come only from real
> sessions.

---

## 1. Categories (every request lands in exactly one)

| Category | Definition | Typical resolution | Owner |
| --- | --- | --- | --- |
| **Documentation** | The capability exists; the customer didn't find/understand it | Improve Onboarding/Pilot Guide or in-product copy | Docs |
| **Configuration** | Solvable with existing white-label options (brand, theme, feature visibility, tier) | Adjust `lib/white-label/` tenant config | Implementation |
| **Decision OS Expansion** | Needs a new **provider-agnostic contract** (new intelligence) | Roadmap item for Decision OS (frozen during pilots) | Engineering (post-pilot) |
| **Visualization Enhancement** | Improves executive *presentation* only; data already exists | Executive-viz change (additive, respects V4.0 boundary) | Engineering (post-pilot) |
| **Out of Scope** | Doesn't align with Fantasy OS strategy (e.g. provider-specific UI, B2C, gambling) | Decline, with rationale | Product |

**Routing tie-breakers:**
- If a request could be Documentation *or* Configuration → prefer **Documentation** first (cheapest, no
  code); escalate to Configuration only if docs don't resolve it.
- If it needs new numbers that don't exist in any snapshot → **Decision OS Expansion** (not Visualization).
- If it only re-presents existing snapshot data → **Visualization Enhancement**.
- Provider-specific asks → **Out of Scope** (the executive layer is provider-agnostic by design).

## 2. Prioritization rule

Prioritize **only validated, recurring** requests. A request earns priority by **frequency across
distinct pilots**, not by the seniority or volume of a single voice.

**Priority score = Recurrence × Strategic fit × (1 / Effort)**, judged qualitatively:

| Factor | Low | High |
| --- | --- | --- |
| Recurrence | 1 pilot | ≥3 pilots (or ≥2 in the same archetype) |
| Strategic fit | tangential to the executive-decision thesis | core to it |
| Effort | new Decision OS contract + surface | config/doc change |

Anything appearing in **only one pilot** is logged as a *data point*, not a roadmap commitment.

## 3. Working table (fill from Observation Logs)

| # | Request (paraphrase) | Source pilots | Recurrence | Category | Strategic fit (L/M/H) | Effort (L/M/H) | Priority | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | _(from logs)_ | | | | | | | |

## 4. Category rollup (fill after categorizing)

| Category | # requests | # recurring (≥2 pilots) | Top item |
| --- | --- | --- | --- |
| Documentation | | | |
| Configuration | | | |
| Decision OS Expansion | | | |
| Visualization Enhancement | | | |
| Out of Scope | | | |

## 5. Guardrails

- **No Decision OS changes during the pilot window** — Decision OS Expansion items are roadmap candidates,
  captured now, built after the pilot phase closes.
- **Configuration changes must stay within existing white-label options** — if a request needs a new config
  primitive, it is Decision OS/Visualization roadmap work, not a per-pilot custom change.
- **No per-pilot custom code** unless explicitly approved as product-roadmap work.
- Keep the Out of Scope column honest — declining a misaligned request with a clear reason is a valid,
  valuable outcome.

# Fantasy OS — Customer Route & Data-State Map + Seven-OS Visual State Matrix (Phase V8.5)

**Branch:** `g15-event-foundation` · **Scope:** customer-facing executive experience audit. Evidence
levels are labeled throughout: **[gateway-live]** (verified on the running `/fantasy-os`), **[component-test]**
(deterministic RTL), **[code-audit]** (traced, not rendered live), **[needs-auth-session]** (requires an
authenticated DB account — not verifiable from the file corpus).

> **Load-bearing honesty:** the persisted validation corpus is a *separate engineering store*. The customer
> hubs render from **DB-backed product endpoints** (manager-command-center, commissioner-hub-health), not
> from that corpus. So deep real-data visual QA of the seven hub workspaces requires an **authenticated DB
> session driven through the browser** — which this phase does not claim to have performed. Where that is
> the case, the state is marked **[needs-auth-session]**, not asserted as validated.

---

## 1. Route & OS ownership map (Part 1)

| Route | Owns | View models | Data source | Notes |
| --- | --- | --- | --- | --- |
| `/fantasy-os` | Gateway (no workspace) | — | live/preview via Demo Truth Model | **[gateway-live]** HTTP 200; Preview/Live badges; no impl terms |
| `/manager-hub` | Platform, Manager, Waiver, Draft OS | `managerSeasonViewModel`, `platformFocusViewModel`, `waiverDecisionViewModel`, `draftDecisionViewModel` | DB endpoint `manager-command-center` | **[needs-auth-session]** for populated states |
| `/commissioner-hub` | Commissioner, League, Trade OS | `commissionerLeagueHealthViewModel`, `leagueMomentumViewModel`, `tradeMarketViewModel` | DB `commissioner-hub-health` + `league-analytics`; **built-in preview** when no leagues | preview path **[gateway-live via link]**; populated **[needs-auth-session]** |

Context selection: the gateway's portfolio selector (All → Platform OS; per-league → league page); the
Commissioner Hub selects a league internally for League/Trade OS. Navigation returns to the gateway/hub
portfolio view; no dead-end routes were found in the audit. Preview and live are distinguished by the Demo
Truth Model badges (Part 2) — preview is never labeled live.

## 2. Seven-OS visual state matrix (Parts 4–11)

Each state's verification evidence is labeled. "Empty/unavailable/loading" state *code paths* are covered by
the existing executive-viz component tests **[component-test]**; populated **real-data** states on the hubs
are **[needs-auth-session]**.

| OS | Populated | Empty-healthy | Unavailable | Partial history | Loading | Provider-neutral | Key honesty note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Platform | [needs-auth-session] | [component-test] | [component-test] | [code-audit] | [component-test] | [component-test] | No historical pulse (no series exists) — honest |
| Manager | [needs-auth-session] | [component-test] | [component-test] | [code-audit] | [component-test] | [component-test] | **Full manager recommendation composition is BLOCKED** (V8.4) — UI must show a truthful state, not preview-as-live |
| Commissioner | [needs-auth-session] | [component-test] | [component-test] | [code-audit] | [component-test] | [component-test] | context-incomplete signals must read differently from real health defects |
| League | [needs-auth-session] | [component-test] | [component-test] | [code-audit] | [component-test] | [component-test] | No momentum trend unless real snapshots exist |
| Trade | [needs-auth-session] | [component-test] | [component-test] | [code-audit] | [component-test] | [component-test] | No valuation / scarcity / acceptance-probability (deferred, test-enforced) |
| Waiver | [needs-auth-session] | [component-test] | [component-test] | [code-audit] | [component-test] | [component-test] | Ordered *sequence*, not a timeline; no deadline language |
| Draft | [needs-auth-session] | [component-test] | [component-test] | [code-audit] | [component-test] | [component-test] | No ADP/value-curve; no false urgency without a draft date |

**No OS is claimed as "fully live."** Manager-specific composition and the DB resolvers remain blocked
(V8.4); the matrix reflects that honestly.

## 3. Per-OS results (Parts 5–11), by evidence

- **Platform OS** — flagship + workload + attention cards verified provider-neutral, one-home ownership,
  no double-counting **[component-test]**; populated real-data ordering **[needs-auth-session]**.
- **Manager OS** — trajectory/timeline/risk view models + Waiver/Draft exclusion verified **[component-test]**;
  because full manager composition is blocked, the truthful-state requirement is documented, and the gateway
  live path degrades to **Data unavailable** rather than presenting preview as live **[gateway-live]**.
- **Commissioner OS** — health map + supporting cards; context-incomplete vs real-defect distinction is a
  known requirement (the V8.3 finding that `context_incomplete` fires on unavailable financial/draft
  evidence) **[code-audit]**.
- **League/Trade/Waiver/Draft OS** — deferral guarantees (no momentum without series; no valuation; no
  deadline; no ADP) are **test-enforced** by the executive-viz suite **[component-test]**; populated states
  **[needs-auth-session]**.

## 4. Demo script verification (Part 18)

The V6.0 Executive Demonstration Script was walked against the actual routes. Steps 1–4 (enter Fantasy OS,
select a portfolio, understand live vs preview, cross-league attention) are **[gateway-live]** verifiable
today. Steps 5–12 (manager context → draft readiness → freshness → return) require an **[needs-auth-session]**
populated account; the flow and routing are correct, but populated intelligence is not claimed. No fictional
customer reactions were written.

## 5. Limitations (carried into the certification)

- Populated real-data visual QA of the seven workspaces needs an authenticated DB session (browser).
- Manager composition + DB resolvers blocked (V8.4); the diverse cohort is unsupplied.
- The automated QA browser renders the gateway reliably (verified) but authenticated hub walkthroughs are
  not reliably scriptable here — deterministic component/route tests are used instead, disclosed honestly.

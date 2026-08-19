# AllFantasy Decision OS — Manager + Commissioner Demo Flow

**Purpose:** one guided pathway that shows the whole Decision OS story — a real league →
personal Manager Intelligence → league Commissioner Intelligence → Chimmy's historical context —
with the safety boundary intact (observations, never unsafe recommendations).

> For the **partner/investor pitch** version (narrative + scene-by-scene talk track), see
> [DECISION_OS_DEMO_STORYBOARD.md](./DECISION_OS_DEMO_STORYBOARD.md). This doc is the operational
> runbook (flags, routes, prerequisites); that one is the presentation.

**Status:** **Ready to demo** with seeded / live-like data. **NOT** yet validated against approved
non-prod live Sleeper data — see [Live-validation status](#live-validation-status). Nothing here
claims a live pass happened.

---

## The story (what the demo proves)

```
AllFantasy imports or hosts a league
  → Decision OS observes real league state (stored config + behavioral events)
    → Managers get personal intelligence  (/league/[id]/manager-hub)
    → Commissioners get league intelligence (/league/[id]/intelligence)
    → Chimmy can explain historical replay context (observational only)
  → no unsafe recommendation boundary is crossed
```

Discovery: **league home** (the League tab) is the launcher. It shows entry cards for **Manager
Intelligence** (all members; visible only when the hub client flag is on) and **League
Intelligence** (the Commissioner hub; member-readable, commissioner-only cards are API-gated).
League home does **not** duplicate hub contents.

---

## Prerequisites

- **Auth roles:** any league member for Manager Intelligence + the member-readable Commissioner
  sections (Activity, Audit Feed, member Stories). A **commissioner** session for the
  commissioner-only cards (Health, Action Items, Trade Review, Rule Settings, commissioner
  Stories) — non-commissioners get an honest "Commissioner only" state, never leaked data.
- **Feature flags:** see the [one-place flag summary](#feature-flag-summary) — enable in the demo
  env only, never as production defaults.
- **Data:** most modules read projected `DomainEvent`s → a league needs **native in-app activity**
  to look full. Import-only Sleeper leagues render sparse EXCEPT **Rule / Settings**, which reads
  stored configuration and shows real data even on an import-only league (see the seed runbook).

---

## Feature flag summary (one place)

Enable all of these in the **demo / non-prod** environment (not production defaults):

```bash
# Manager Intelligence hub + its entry card on league home
NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED=true
# Manager: Historical Replay card (client + server both required)
NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED=true
MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED=true
# Manager: the three deterministic module routes
MANAGER_TEAM_HEALTH_ENABLED=true
MANAGER_WEEKLY_OUTLOOK_ENABLED=true
MANAGER_TRANSACTION_READINESS_ENABLED=true
# Commissioner: the two default-off module routes (Trade Review + Rule Settings)
COMMISSIONER_TRADE_REVIEW_ENABLED=true
COMMISSIONER_RULE_SETTINGS_ENABLED=true
# Chimmy: observational historical-replay context (trade intent only)
CHIMMY_REPLAY_CONTEXT_ENABLED=true
```

**Base Commissioner hub gating:** the Commissioner hub (`/league/[id]/intelligence`) has **no
client feature flag** — it is always mounted and gated by **auth (session role)** and **data
(precomputed `IntelligenceLeagueSnapshot`)**. Its base modules (Activity / Health / Action Items /
Stories / Audit Feed) have **no dedicated env flags**; only the two newest commissioner modules
(Trade Review, Rule Settings) are flag-gated as above. (The public keyed Intelligence API's
`DECISION_OS_INTELLIGENCE_API_ENABLED` is a *separate* surface the hub does not use.)

---

## Manager walkthrough

1. Open a league as a member → **League** tab → **Manager Intelligence** card → `/league/[id]/manager-hub`.
2. Walk the five modules: **Historical Replay** (validated observations), **League Context**
   (standings), **Team Health**, **Weekly Outlook**, **Transaction Readiness**.
3. Framing: *"Understand roster health, weekly outlook, transactions, and historical decision
   patterns."* Every signal is observational — it describes your team; it does not tell you which
   move to make.

## Commissioner walkthrough

1. Open the league as a **commissioner** → **League** tab → **League Intelligence** card → `/league/[id]/intelligence`.
2. Walk the seven modules: **Activity**, **Health**, **Action Items**, **Trade Review**,
   **Rule Settings**, **Stories**, **Audit Feed**.
3. Framing: *"Monitor league health, activity, trade-review workload, rules, and audit history."*
   Trade Review shows review **workload**, not fairness verdicts; Rule Settings **describes**
   configuration, never judges it.

## Chimmy replay-context walkthrough

1. With `CHIMMY_REPLAY_CONTEXT_ENABLED=true`, ask Chimmy a **trade** question.
2. Chimmy may include a **"Historical Replay Summary (observational only)"** section with the
   disclaimer that these summarize past outcomes and are **not recommendations**.
3. Show that Chimmy stays observational — it never turns replay evidence into a prescribed move.

---

## Safety framing (say / never say)

**Say:** "Managers get personal intelligence. Commissioners get league intelligence. Everything is
grounded in the league's own data, and it's observational — describing state, not dictating moves."

**Never say:** "The AI tells you what to do," "guaranteed winning," or "automated commissioner
decisions." Decision OS observes and explains; the human still decides.

---

## Known blockers

1. **Live data needs native activity.** Manager + most Commissioner modules read projected
   `DomainEvent`s; import-only Sleeper leagues render sparse. Use a league with real in-app
   activity, or seed events (see
   [snapshot seed runbook](./COMMISSIONER_INTELLIGENCE_SNAPSHOT_SEED_RUNBOOK.md)). Rule / Settings
   is the exception (stored config → always renders).
2. **No live DB from tooling.** `DATABASE_URL` is remote Neon; the hard DB-access rule bars
   connecting without approval, and the A1 routes need an authed session. A true screenshotted
   pass requires an approved non-prod environment.

---

## Live-validation status

| Statement | True today? |
| --- | --- |
| Ready to demo with seeded / live-like data | ✅ yes (flags + a league with activity) |
| Validated against approved non-prod live Sleeper data | ❌ not yet — needs an approved non-prod run |

To promote "ready" → "validated," follow the Manager
[non-prod runbook](./MANAGER_INTELLIGENCE_NONPROD_VALIDATION_RUNBOOK.md) and the Commissioner
[demo-readiness](./COMMISSIONER_INTELLIGENCE_DEMO_READINESS.md) + [seed runbook](./COMMISSIONER_INTELLIGENCE_SNAPSHOT_SEED_RUNBOOK.md)
in an approved non-prod env, and record the results there. Do not mark this validated until that
happens.

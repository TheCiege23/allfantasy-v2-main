# Manager Intelligence Hub — Non-Prod Live Sleeper Validation Runbook

**Purpose:** a safe, explicit, repeatable workflow to validate the Manager Intelligence Hub
against **real Sleeper-imported AllFantasy data** without risking production data or violating
DB-access rules.

**State:** _Ready to validate._ This runbook prepares the proof pass. It does **not** assert
that live validation happened — that is true only once someone runs it in an approved non-prod
environment and records results below. See [proof doc](./MANAGER_INTELLIGENCE_LIVE_SLEEPER_PROOF.md).

**Safety rule (non-negotiable):** never connect to remote Neon / staging / production without
explicit approval. The helper script is **read-only and refuses to run** unless the target is an
acknowledged, confirmed non-prod database. It never writes and never calls a recommendation
endpoint.

---

## 1. Environment Requirements

Required feature flags (set in the **non-prod / local** environment only — never as prod defaults):

```bash
# client (inlined at build) — hub shell + replay card
NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED=true
NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED=true

# server — each module's internal A1 route (independent gates)
MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED=true
MANAGER_TEAM_HEALTH_ENABLED=true
MANAGER_WEEKLY_OUTLOOK_ENABLED=true
MANAGER_TRANSACTION_READINESS_ENABLED=true
```

Also required:

- **`DATABASE_URL` → an approved non-prod database** containing the imported Sleeper league.
  (The repo's default `DATABASE_URL` is remote Neon and is **out of bounds** for this pass.)
- **An authenticated test user** who is a member of the imported league. The A1 routes return
  `401` (no session) / `403` (not a member) before any DB read otherwise.
- **A Sleeper-imported league** present in that non-prod DB (see §2).

Optional safe helper (verifies the environment + probes readiness, read-only):

```bash
NONPROD_VALIDATION_ACK=true \
NONPROD_DB_CONFIRMED=true \                 # only if the URL has no localhost/staging/dev marker
MANAGER_VALIDATION_LEAGUE_ID=<leagueId> \
npx tsx scripts/manager-intelligence/validate-nonprod-readonly.ts
```

It prints the plan + flag checklist + a safety assessment, and **refuses to query** unless the
gate passes. Without `MANAGER_VALIDATION_LEAGUE_ID` it is a plan-only dry run.

---

## 2. Approved Test League

Preferred source (if present in the non-prod DB):

- **Sleeper username:** `theciege24`
- **League:** _KBI Smoke Black_ was previously imported to **staging** by the Decision OS F.0
  non-prod import runner (see the Canonical World / F.0 notes). Confirm the exact `leagueId`
  in your non-prod DB before validating and record it here:

  ```txt
  leagueId:  <fill in once confirmed>
  season:    <fill in>
  imported:  <date / import run>
  ```

> **Honesty gate:** if the local/non-prod DB does **not** contain an imported Sleeper league,
> STOP and record that here as the blocker. Do not invent a league or fake results. Re-run the
> Decision OS F.0 non-prod import runner to seed one first.

---

## 3. Module Validation Checklist

Open `/league/<leagueId>/manager-hub` as the authenticated test user. For each module, record:

| Module | data present? | empty state? | null handling? | raw ID leak? | rec-language leak? | visual | mobile |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Historical Replay | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| League Context | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Team Health | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Weekly Outlook | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Transaction Readiness | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

Pass criteria per module: renders the contract correctly, degrades to an honest empty/`unknown`
state when data is missing, shows **no raw provider IDs**, and uses **no recommendation/advice
language** (descriptive only).

---

## 4. API Validation Checklist

Exercise each internal route (all **read-only**, session-authed). Record status per state:

| Route | 401 (no session) | 403 (non-member) | disabled (flag off) | success (data) | empty (no data) |
| --- | --- | --- | --- | --- | --- |
| `/api/leagues/[leagueId]/replay-insights` | ☐ | ☐ | ☐ | ☐ | ☐ |
| `/api/app/leagues/[leagueId]/standings` | ☐ | ☐ | n/a | ☐ | ☐ |
| `/api/app/leagues/[leagueId]/team-health` | ☐ | ☐ | ☐ | ☐ | ☐ |
| `/api/app/leagues/[leagueId]/weekly-outlook` | ☐ | ☐ | ☐ | ☐ | ☐ |
| `/api/app/leagues/[leagueId]/transaction-readiness` | ☐ | ☐ | ☐ | ☐ | ☐ |

Also confirm, across the pass:

- **No writes** — DB row counts unchanged before/after (the routes/providers are read-only).
- **No recommendation endpoint calls** — network tab shows only the five routes above; no
  `/api/ai*`, `/api/ai-tools/*`, waiver/trade recommendation, or trade-finder calls.

---

## 5. Demo Script (company-friendly)

1. **Import / select** a Sleeper league (real AF import).
2. Open **league home**.
3. Open the **Manager Intelligence Hub** (`/league/<id>/manager-hub`).
4. Walk the **five modules**: Historical Replay, League Context, Team Health, Weekly Outlook,
   Transaction Readiness — all grounded in the league's own data.
5. Explain the **observational boundary**: "Every signal describes your situation. None of it
   tells you which move to make. That's a separate, later capability."
6. Open **Chimmy** and ask a **historical-replay** question.
7. Show that Chimmy stays on the **observational side** — it summarizes historical replay context
   and does not turn it into a recommendation.

Keep it company-friendly: real league data, no backend/DB details, no raw IDs, no "AI magic"
claims — lead with **trust & safety** and the **provider-agnostic** future (Sleeper today, other
platforms later, same hub).

---

## Results log

Record the outcome of an actual pass here (date, operator, league, findings, screenshots). Until
this section is filled from a real non-prod run, the correct status is **"Ready to validate,"
not "validated."**

```txt
(no live pass recorded yet — see the blocker in the proof doc)
```

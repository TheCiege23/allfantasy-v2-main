# G15.9 — Chimmy Commissioner Intelligence Grounding

**Status:** complete. Teaches Chimmy to consume the G15 read models (via the Intelligence Query
Service — the **only** data source) as grounding for commissioner / league-health questions.
AI grounding only — no Story Engine, no write actions, no new Hub UI, no event-architecture
changes, no raw provider/payload access.

---

## 1. Integration point
- **Adapter:** `lib/intelligence/chimmy/commissionerGrounding.ts`
  - `detectCommissionerIntelligenceIntent(question)` — pure intent router.
  - `buildCommissionerGrounding({ service, leagueId, principal })` — privacy-safe grounding from
    the `IntelligenceQueryService`; **never throws** (degrades to `empty`/`restricted`).
  - `formatCommissionerGroundingText(summary)` — pure, privacy-safe LLM text.
- **Wired:** `GET /api/intelligence/snapshot?leagueId=…&q=<question>` (the existing Chimmy/dashboard
  grounding endpoint). When `q` matches commissioner intent (or `?commissioner=1`) **and** the
  caller is a **commissioner** of the league, the response gains an additive
  `commissionerIntelligence` block. Best-effort: the base snapshot is never affected; existing
  Chimmy behavior is preserved for everyone else.
- **Chimmy pipeline usage (documented):** the chat layer already fetches the snapshot for league
  grounding; for commissioner questions it passes the user's `q` (or `commissioner=1`) so the
  grounding block is attached, then includes `commissionerIntelligence.text` in the model context.
  (The 748-line dual-pipeline chat proxy is intentionally **not** surgically edited — the grounding
  flows through the clean, additive snapshot contract.)

## 2. Grounding data used (all via the Query Service)
- **League Activity Summary** — totals, per-category counts, open trade proposals, last activity.
- **League Health Snapshot** — score, status, active/total managers, days since activity.
- **Commissioner Action Items** — `{kind, severity, message}` only (**meta stripped** — no user ids).
- **Audit Feed / recent timeline** — recent privacy-safe summaries (labels + timestamps).
- (Per-manager `getManagerActivitySnapshot` is available for follow-ups; the default grounding uses
  the count-based action items rather than naming managers.)

## 3. Safety / privacy rules
- **No** raw event payloads, chat content, provider tokens, or user ids/names in the output
  (`summary` strips action-item `meta`; the text uses counts + labels only). Verified by test.
- The grounding **text** carries a directive: cautious, **non-accusatory** language; **never**
  allege collusion/tanking; frame inactivity as "appears inactive based on recorded activity."
- **Empty state:** if `totalEvents === 0`, returns an `empty` grounding telling Chimmy it lacks
  enough league activity yet + safe next steps (start season, encourage moves, check back).
- **Permission / feature-gate:** commissioner-only data is gated twice — the route requires
  `assertLeagueCommissioner`, and the service applies the feature gate; a denial degrades to a
  `restricted` grounding (never a crash, never a leak).

## 4. Sample supported questions
"Why is my league inactive?" · "Who needs commissioner attention?" · "What happened recently in my
league?" · "What should I do to improve league health?" · "Are there pending issues?" · "Who has
been most active?" · "Give me a commissioner summary."

**Sample grounding text (ok):**
```
COMMISSIONER INTELLIGENCE (read-only…). Use cautious, non-accusatory language. Do NOT allege collusion…
League activity:
- total recorded events: 42
- last activity: 2026-06-27T00:00:00.000Z
- open trade proposals: 1
- activity by type: trade=3, waiver=10, lineup=20, draft=1, scoring=8
League health:
- health score: 72/100 (healthy)
- active managers: 10/12
- days since last activity: 1
Action items (observations, not accusations):
- [warning] 1 trade proposal(s) awaiting resolution.
Recent timeline:
- Trade accepted (2026-06-27T00:00:00.000Z)
```
**Empty:** "There is not enough recorded league activity yet to assess league health. Suggest safe
next steps: confirm the season has started…"

## 5. Tests
`__tests__/intelligence/commissioner-grounding.test.ts`: intent detection (7 example questions
match; ordinary fantasy questions don't); pure text formatting (cautious + privacy-safe); build
ok/empty/restricted; **never-throws** on unexpected error; **no user-id/payload leak** (stripped
meta). Existing intelligence + API + UI suites unchanged (regression-safe — adapter + additive
route only).

## 6. Limitations
- Grounding is attached via the snapshot contract; the chat pipeline must pass `q`/`commissioner=1`
  to receive it (documented). The streaming chat proxy was not edited.
- Health/manager richness needs user-actor (manager) events; engine/system events populate activity
  + audit feed but not per-manager rows.
- Feature gate is allow-all today; when premium gating turns on, the `restricted` path already
  handles denial cleanly.
- Read models populate only once the relay runs in prod (G15.8 runbook) — until then Chimmy gets
  the `empty` grounding (safe).

# The Replacements × AllFantasy — Commissioner OS Technical Discovery Handoff

**Purpose of this document:** a client-facing technical discovery guide for the next conversation
with The Replacements about a Commissioner OS pilot. It explains what Commissioner OS does, what
data would power a pilot, sample (non-binding) payload shapes to react to, and the specific
questions we need answered to scope real integration work.

**This is a discovery document, not a contract, not a finished integration, and not a promise of
measured results.** No retention-lift, engagement-lift, or ROI figures are stated anywhere below —
none have been measured yet on any partner's data, and any pilot's first job is to start measuring,
not to assume an outcome.

**For live use on the call itself:** see
[`THE_REPLACEMENTS_CALL_SCRIPT.md`](THE_REPLACEMENTS_CALL_SCRIPT.md) — a shorter, spoken-language
talking-points guide distilled from this document, meant to be used in the room; use this document
as the detailed leave-behind afterward.

---

## 1. Executive Summary

AllFantasy has built **Decision OS**, an intelligence engine that turns real fantasy league activity
(trades, waiver claims, roster moves, drafts) into commissioner-facing signals, and **Commissioner
OS**, the product surface that shows those signals to a commissioner — today, concretely, a live
**Mission Control** view covering league health, activity trend, manager engagement, retention risk,
and recommended actions.

This is already real and working on AllFantasy's own leagues today. The purpose of a pilot with The
Replacements would be to prove it works the same way on **your** league data — without requiring any
change to how your platform runs, without needing full access to your systems, and without needing
anything beyond a read-only feed of league activity.

This document is the technical starting point for that conversation: what we'd need from you, what
we'd build on our side, what a successful pilot looks like, and the open questions we need answered
before scoping real engineering work.

---

## 2. What Commissioner OS Does For The Replacements

For each league, Commissioner OS gives a commissioner (or your platform's own team, if you want to
offer this to your users) a single view showing:

- **League health** — an overall status (e.g. healthy / needs attention / at risk), computed
  deterministically from real activity, not a black-box AI guess.
- **Activity trend** — is engagement in this league increasing, decreasing, or flat over time.
- **Active vs. inactive managers** — a real count, not an estimate.
- **Trade, waiver, draft, and roster activity** — how much is actually happening in the league.
- **Managers at retention risk** — flagged with the specific behavioral reason (e.g. declining
  activity), not just a generic red flag.
- **Recommended commissioner actions** — concrete, prioritized suggestions (e.g. "reach out to
  inactive managers," "activate trade discussion") grounded in the same real data, not arbitrary
  suggestions.

Every one of those either shows a real, computed value, or an honest "not enough data yet" state —
never a placeholder or a guess.

---

## 3. What Decision OS Needs From Their Platform

At its core, Decision OS needs **a feed of what happened in a league, by whom, and when** — trades,
waiver claims, roster moves, and draft picks. It does **not** need your full platform, your users'
credentials, or a copy of your entire database.

Concretely, per event, we need:
- A stable **league identifier**.
- A stable **manager/team identifier** for everyone involved (does not need to correspond to an
  AllFantasy account — Commissioner OS already supports fully external managers).
- What **kind** of event it was (trade, waiver claim, roster move, or draft pick).
- A **stable event identifier** (so re-sending the same event never creates a duplicate).
- A real **timestamp** for when it happened.

That is genuinely the core of it. Everything Commissioner OS shows today is derived from that
activity stream.

---

## 4. Minimum Data Needed For A Pilot

The smallest dataset that would let us run a real, working pilot:

- A small set of pilot leagues (not your whole platform) — you choose which and how many.
- For each pilot league: its trades, waiver claims, roster moves, and draft picks, with stable ids,
  stable manager/team ids, and real timestamps (see §3).
- Ideally, some **historical** activity (even a partial season) so trend/retention signals have
  something to work with from day one, rather than needing to accumulate for the first couple of
  weeks live.

That's it. No roster contents, no scoring rules, no live game data, no user profile information is
required for this pilot's core signals.

---

## 5. Preferred Integration Options

In rough order of what's typically lowest-effort for a partner, from most to least preferred — but
we're flexible and want your input on what's realistic for your platform:

1. **A read-only API** we call periodically to pull recent activity (most flexible, easiest to
   iterate on from our side).
2. **A periodic data export** (e.g. a scheduled file drop or one-time historical export plus
   incremental exports) if a live API isn't available or isn't the right first step.
3. **Webhooks** you push to us when activity happens, if you already have (or would rather build)
   an event-push system.

Any of these work with the same downstream pipeline on our side — the choice mainly affects how
"live" the data feels, not what we're able to build with it.

---

## 6. Sample Data Contract

A **non-binding** sketch of the fields we'd want per entity — meant to be reacted to and adjusted to
match whatever your platform's actual data model looks like, not treated as a required schema.

**League**
- `league_id` (stable, unique)
- `league_name` (optional, for display only)

**Manager / Team**
- `manager_id` or `team_id` (stable, unique, does not need to map to any AllFantasy account)
- `display_name` (optional, for display only)

**Event (trade / waiver / roster move / draft pick)**
- `event_id` (stable, unique — prevents duplicate processing if the same event is sent twice)
- `event_type` (`trade` | `waiver` | `roster_move` | `draft_pick`)
- `league_id`
- `participants` (one or more manager/team ids involved)
- `occurred_at` (a real timestamp — see §10/§11 on what "real" means here)
- `status` (for trades/waivers specifically — see §9 in the payload examples below)

---

## 7. Example Event Payloads

These are illustrative shapes only — **not a required schema**. Field names, casing, and structure
should follow whatever is natural for your platform; we'll adapt on our side.

**League**
```json
{
  "league_id": "league_abc123",
  "league_name": "Sunday Night Dynasty"
}
```

**Manager / Team**
```json
{
  "manager_id": "mgr_9f21",
  "team_id": "team_772",
  "display_name": "Team Chaos"
}
```

**Trade event**
```json
{
  "event_id": "txn_55901",
  "event_type": "trade",
  "league_id": "league_abc123",
  "participants": ["mgr_9f21", "mgr_1a44"],
  "status": "completed",
  "occurred_at": "2026-07-05T18:32:00Z"
}
```

**Waiver event**
```json
{
  "event_id": "txn_55902",
  "event_type": "waiver",
  "league_id": "league_abc123",
  "participants": ["mgr_1a44"],
  "status": "awarded",
  "occurred_at": "2026-07-06T04:00:00Z"
}
```

**Roster move event**
```json
{
  "event_id": "txn_55903",
  "event_type": "roster_move",
  "league_id": "league_abc123",
  "participants": ["mgr_9f21"],
  "status": "completed",
  "occurred_at": "2026-07-06T14:12:00Z"
}
```

**Draft pick event**
```json
{
  "event_id": "draft_2026_pick_14",
  "event_type": "draft_pick",
  "league_id": "league_abc123",
  "participants": ["mgr_1a44"],
  "draft_id": "draft_2026",
  "round": 2,
  "pick_number": 14,
  "occurred_at": "2026-08-15T20:00:00Z"
}
```

---

## 8. Authentication / Security Questions

- What authentication does your API (or export mechanism) support — API key, OAuth2, signed
  requests/webhooks, something else?
- Can access be scoped to **read-only**, and limited to only the pilot leagues we agree on, rather
  than your whole platform?
- Are there IP allowlisting, rate limiting, or other access controls we should design around?
- Who on your side owns credential issuance and rotation for a pilot integration?

---

## 9. Tenant / Client Isolation Questions

- Beyond the pilot, would The Replacements ever expect other partners' leagues to be handled
  side-by-side with yours in the same system, or would this always be a dedicated setup?
- Do you have a concept of "workspace" or "organization" on your platform that should map to how we
  scope/isolate your leagues on our side?
- Is there a data residency, retention-period, or deletion requirement (e.g. "delete our data if the
  pilot ends") we should design for from the start?

---

## 10. Historical Backfill Questions

- How much historical activity can you provide at pilot onboarding — a full season, multiple
  seasons, or only activity going forward from when the integration starts?
- For historical data specifically: do timestamps exist for every historical event, or only for
  some (e.g. drafts often don't have a per-pick timestamp on many platforms — a single real
  timestamp for the whole draft is enough if that's what you have)?
- Is a one-time historical export acceptable, or would backfill need to happen incrementally
  through the same live mechanism as ongoing sync?

---

## 11. Live Sync Questions

- Once a pilot is running, how "live" does activity need to be for Mission Control to be useful to
  your commissioners — daily is enough for the current trend signal, but tell us if you'd want
  faster.
- If we poll your API, what request volume/rate limit should we design against?
- If you'd rather push events to us (webhooks), do you already have infrastructure for that, or
  would it need to be built?
- How do you represent a transaction that's still pending/proposed vs. one that's finalized? We
  only want to count finalized activity — never something still in progress.

---

## 12. Pilot Success Criteria

Measurable, honest, and explicitly **not** ROI or retention-lift claims — those require a real
baseline and observation period this pilot would be the start of, not the conclusion of:

- **Successful ingestion of the agreed sample/pilot leagues** — activity events land correctly,
  re-sending the same event never creates a duplicate.
- **Mission Control populated from real data** for each pilot league — real health status, real
  manager counts, real activity counts, not placeholders.
- **League Health populated from real data** — the same underlying counts feeding a real health
  score.
- **Trend history captured across at least two time periods** — enough for a real "increasing /
  decreasing / flat" activity signal to appear, rather than "not enough history yet."
- **Retention-risk managers identified from real activity patterns** — specific managers flagged
  with real, explainable reasons, for leagues where that pattern genuinely exists (an honest "none
  flagged" is also a valid, successful outcome for a healthy league).
- **Commissioner action recommendations generated from real signals** — visible, explainable
  suggestions tied to the real data behind them.

None of these criteria involve measuring whether commissioners changed behavior, whether managers
stayed longer, or any business outcome — that would be a **later**, separate measurement phase, only
possible once a pilot has been running long enough to have a real baseline.

---

## 13. What AllFantasy Will Provide

- The Commissioner OS product surfaces (Mission Control, League Health, trend, retention risk,
  recommended actions) — already built and working on our own leagues today.
- The engineering work to build a data adapter that turns your activity feed into the format our
  system needs — once we agree on the data contract together.
- A non-production environment to validate the pilot integration before any shared/production data
  path exists.
- Clear, ongoing communication about what's real vs. still in progress at every stage — the same
  standard this document itself holds to.

## 14. What The Replacements Must Provide

- Access to a small set of pilot leagues' activity data (trades, waivers, roster moves, draft
  picks), via whichever mechanism from §5 makes sense for your platform.
- Stable identifiers for leagues, managers/teams, and individual events (§3/§6).
- Real timestamps for those events (§10/§11).
- A point of contact on your side for the technical questions in §8–§11.
- Sign-off on a data-sharing arrangement covering the pilot leagues and duration.

---

## 15. Open Questions For The Next Call

1. Do you have a documented API today, or would this start as a data export?
2. What authentication does your platform support for third-party read access?
3. Are your league, team/manager, and event identifiers permanent, or can they change/be reused?
4. Do your transactions carry a real timestamp, and is it a submission time, a finalized time, or
   both?
5. How do you distinguish a pending/proposed transaction from a completed one?
6. Do drafts have a stable identifier, and is there any per-pick timestamp available?
7. How much historical activity could you provide at onboarding?
8. What volume should we expect (leagues, managers per league, transactions per week)?
9. Which specific leagues would be included in a pilot, and for how long?
10. Who owns data-sharing/privacy sign-off on your side, and what would that agreement need to
    cover?
11. Is there any activity signal beyond trades/waivers/roster-moves/drafts you think would be
    valuable for us to know about (e.g. commissioner actions, league chat activity) — not required
    for this pilot, but useful to understand for the future?

---

## 16. What We Are Not Asking For Yet

To be explicit, so nothing here is over-scoped or ambiguous:

- **No full app/platform migration.** This is a data feed into an intelligence layer, not a
  migration of your platform or your leagues into AllFantasy.
- **No user passwords or account credentials.** We never need your users' login information.
- **No payment or billing data.**
- **No private direct messages or personal communications.**
- **No full roster/scoring engine integration.** We don't need your live scoring rules, current
  roster lineups, or matchup results for this pilot's signals.
- **No DFS (daily fantasy) data.**
- **No production write access to your platform.** This is a read-only integration — we never need
  to write anything back to your systems.
- **No retention-lift, engagement-lift, or ROI commitment.** A pilot's job is to prove the signals
  work on your real data; measuring business impact is a separate, later, honest measurement effort
  once a real baseline exists.

---

**Related documents:**
[`THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md`](THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md)
(the product demo package this handoff follows) and
[`THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md`](THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md) (the
internal engineering plan this handoff is the client-facing counterpart to).

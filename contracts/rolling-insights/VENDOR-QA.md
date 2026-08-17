# Vendor Q&A Record — Rolling Insights

**Purpose:** durable record of what the vendor told us directly, so nobody re-asks or re-probes.
Undocumented features and explicit "we don't have that" answers both live here.

**Channel:** Discord · **Date:** 2026-08-16 · **Escalation path offered:** support ticket

---

## Answers received

### 1. Webhooks — ✅ YES, and this is the headline

> "Yes, we offer a webhook push option. This can be configured by opening a support ticket with our
> Customer Care team. They can walk you through the available options, some of the decisions you'll
> need to make, and how best to structure the implementation for your use case."

**Impact: removes ~35s of detection lag entirely.** Biggest single architectural win available.

⚠️ **But it is completely undocumented.** The new OpenAPI spec has a top-level `webhooks:` key whose
value is literally `{}`. The word "webhook" appears exactly once in the entire 84-path spec — that
empty key. No payload format, event types, signature scheme, retry policy, or delivery guarantee
exists in writing anywhere.

**Do not build on this until you have the contract in writing.** See follow-ups below.

**Design note:** keep polling as a slower reconciliation net even after webhooks land. Webhook
delivery is rarely guaranteed at-least-once *and* ordered, and the existing `dedupe_key` makes
duplicate delivery harmless. Hybrid — webhook primary, poll every 2–5 min for completeness.

### 2. Live game state — ✅ resolves the all-null observation

> "The currentBox is populated while a game is live, as it represents the current state of the game.
> Once the game has been completed, currentBox will be null."

**Your null payload was a final-state payload. That's expected behaviour, not a bug.**

⚠️ Two naming corrections:
- The vendor's `currentBox` **does not exist in the spec.** The real path is **`full_box.current`**.
- "Current box" is **three different field names across sports** — `full_box.current` (NFL/NCAAFB/NBA),
  `full_box.current_box` (MLB), top-level `current_box` (DARTS). Don't write one accessor.

Full field list in `ENDPOINTS.yaml → endpoints.live.live_game_state`. Note `Quarter` is a **string**,
`YardLine` is an **integer** here but a **string** in play-by-play, and `Possession` is an
**abbreviation** here but a **full team name** in play-by-play.

### 3. Stat corrections — ⚠️ no flag, and they explained why

> "If a statistic is corrected during the game, that correction will be reflected in a subsequent
> version of the live box score. We don't currently provide flags specifically identifying stat
> corrections. In practice, this would be difficult to manage reliably because information can change
> during a live game for several reasons. For example, a play may initially be recorded incorrectly
> at the field level, an official decision may change, the public source data may be updated, or we
> may adjust how a particular play has been interpreted."

That's a fair engineering answer, and it has a hard consequence: **in the box score, a correction is
indistinguishable from a new play.**

**However — the vendor undersold their own schema.** Play-by-play carries officiating-reversal flags
they didn't mention: `details.isReversed`, `isOverruled`, `isReplayOverturned`, `isReplayUpheld`,
`isChallenged`, `noPlay`, `challengeRuling` ("REVERSED"). Those cover the on-field-reversal subset.

Two-layer detection strategy is specced in `PLAY-BY-PLAY.yaml → correction_detection`:

| Layer | Signal | Covers | Confidence |
|---|---|---|---|
| PBP reversal flags | `isReversed`/`isOverruled`/`isReplayOverturned`/`noPlay` | officiating reversals | HIGH |
| Negative delta | a cumulative stat **decreases** between polls | stat-source corrections | MEDIUM |

> 🚫 **Hard rule: never emit an alert on a negative stat delta.** Without that guard, a correction
> fires a phantom "big play" notification. And alerts must be **retractable** — store the
> notification ID against the event row so a reversal can send a correction.

### 4. Projections — ❌ NO

> "We don't currently offer projection endpoints. This is something on our roadmap, however, and you
> can upvote the feature and follow its progress here:
> https://app.loopedin.io/datafeeds-by-rolling-insights#/ideas-board"

Upvote it; plan as if it never ships. Projections come from **Fantasy Nerds** ($499/yr, raw stat
categories, IDP endpoints) or your own model on nflverse. Your instinct in the question was right —
a precomputed fantasy total can't be re-scored for TE premium, IDP, or 6-point passing TDs, which is
exactly why `DK_fantasy_points` is unusable for you.

No rest-of-season endpoint either (question 6 — implicitly answered by "no projection endpoints").

### 5. ADP / trade values / dynasty values — ❌ NO

> "We don't currently provide ADP, trade values, or dynasty player values. We leave these types of
> calculated values to our customers, since different companies often have their own methodologies
> and models for determining them."

FantasyCalc + DynastyProcess remain the values layer, as planned.

**Worth noting for the legal question:** this is a vendor explicitly declining to compete on the
analytics layer. That's a helpful data point for the ToS "products or services competitive to ours"
clause — see follow-up #4.

### 6. Injuries — ⚠️ much slower than assumed, and no practice grid

> "Our injury information is based on information officially reported by teams and made publicly
> available. We do not base injury statuses on rumours or observations from reporters. Injury
> information is collected each morning. On game days, we also collect an additional update
> approximately one hour before each game begins."

**Answer to "same ~1 minute, or slower?" — much slower. Twice a day.**

| | |
|---|---|
| Cadence | Daily each morning + ~T-1h before each game |
| Source | Official team reports only. Explicitly **no** reporter tweets or observations. |
| Practice participation | **❌ Not present** — see below |

**Two consequences:**

1. **Revise the polling plan.** Polling `/injuries` every 35s is wasted — the data changes twice a
   day. Poll ~06:00 local and again T-90m per game. This is your **official-report layer**, not your
   breaking-news layer. A separate breaking-news source (Rotowire) is still required.
2. **The "no rumours" policy is a reliability feature, not a limitation.** Fewer false positives is
   exactly what the developing-vs-confirmed UX needs. Rolling Insights = confirmed. Rotowire =
   developing.

**They did not answer the practice-participation question (DNP/Limited/Full).** The spec settles it:
searching the full OpenAPI for `practice` returns 41 hits, all of them "Best practices" prose.
`participation` = 0, `DNP` = 0, `Limited` = 0. No day-of-week fields. The injuries object is five flat
fields: `player`, `player_id`, `injury`, `date_injured`, `returns`.

So for the Wed/Thu/Fri grid, parse official NFL.com injury reports yourself.

⚠️ Also: `returns` is **free-form prose with no enum** — observed values mix designations and
narrative ("Probable", "60-Day IL", "Questionable For Start Of Training Camp", "TBA"). And
`date_injured` formatting is inconsistent across sports and **not ISO**. Both need a normalization
layer.

### 7. Play-by-play — ✅ included with Live Feed, no separate package

> "Yes, we provide play-by-play data. Play-by-play is currently included for customers who purchase
> our live data, so there is no separate play-by-play package required."

New docs: `https://docs.datafeeds.rolling-insights.com/#tag/Play-by-Play/paths/~1play-by-play~1NFL/get`

**This removes a cost line from the earlier estimate.** Full schema now committed at
`PLAY-BY-PLAY.yaml`. It's genuinely good for your feature set — `yardsGained` for 20+ yard detection,
`isTouchdown`/`isScoringPlay`, an `event` enum covering sack/interception/fumble/field_goal/safety,
and a `players[]` array with roles (`interceptor`, `recoverer`, `defender`) and actions
(`sack`, `tackle`, `pressure`) plus player IDs.

⚠️ Coverage is **still MLB / NBA / NFL only** — confirmed in the new docs. **No NCAAFB
play-by-play.** CollegeFootballData stays.

⚠️ **Touchdowns are not in the `event` enum.** Use `isTouchdown` + `isScoringPlay` +
`details.pointsAfterTouchdown`. There is no `scoringType` field.

---

## ❓ NOT ANSWERED — follow up on these

Ask via support ticket, since they offered that path.

### 1. Webhooks — the full contract (highest priority)

Before we can build on it:

- Payload schema + a real example for `/live` and `/play-by-play`
- Event type list — what triggers a webhook?
- **Do webhooks fire for stat CORRECTIONS, or only new events?** (Critical given #3 above.)
- Signature / HMAC verification scheme
- Retry policy: at-least-once? ordering guarantees? dead-letter?
- Per-game or per-league subscription granularity?
- Is the payload the full box score, or a delta?

### 2. Rate limits — asked, not answered

- What is the documented rate limit for `/live`?
- **Does a 304 count against it?**
- Is there any 429 behaviour we should handle? (The spec declares none on any of 84 operations.)

### 3. The 304 contradiction — needs a ruling

Two vendor sources say opposite things:

| Source | Says |
|---|---|
| Official agent-skill repo (`production`) | "Treat `304` as a cache problem, not a success." Prescribes cache-busting + retry. |
| New OpenAPI spec, `NotModified` component | "Not modified — valid request with no new data to return (**empty result set**)" |

Also: 304 is declared on only **14 of 84** operations, and **only for DARTS and PGA**.
`/live/{date}/NFL` declares just `[200, 401, 403]`.

**Which is authoritative?** And is the absence of a declared 304 on the NFL live path a guarantee it
won't occur?

*(Our implementation is safe either way — cache-bust plus hash-diff works under both readings. But
this should be resolved so the contract can stop carrying the ambiguity.)*

### 4. The competitive-use clause — legal, still open

ToS §12 grants commercial use, then bars using the service to "build or support or assist a third
party in ... products or services competitive to ours," and Rolling Insights sells **SportWise**, a
consumer fantasy analytics product.

Their answer to #5 above — explicitly declining to provide ADP, trade values, or dynasty values
because "we leave these types of calculated values to our customers" — is a **strong indication they
don't consider customer-built analytics competitive.** Get that in writing.

### 5. Live latency

Vendor self-describes as "medium-latency" and never quantifies it. Ask for a number, or measure it
during the 30-day trial with a stopwatch against a broadcast.

### 6. Practice participation — confirm the negative

The spec shows no practice fields. Confirm they're genuinely unavailable rather than undocumented,
since they said injuries come from "officially reported" team sources — and the official NFL injury
report *does* contain the practice grid.

### 7. Breakaway Accelerator eligibility

$60/mo vs ~$3,200/mo list for the full multi-sport Live Feed set. Ask before paying list price.

---

## Net effect on the build

| Item | Before | After |
|---|---|---|
| Detection latency | 35s poll | **Webhook push** (pending contract) |
| Injury polling | 35s | **06:00 + T-90m** — big cost saving |
| PBP cost | assumed separate | **included with Live Feed** |
| Live game state | "possibly unpopulated" | **works; you saw a final-state payload** |
| Correction handling | unknown | **two-layer: PBP flags + negative-delta guard** |
| Projections | maybe | **no — Fantasy Nerds or DIY** |
| Values | maybe | **no — FantasyCalc stays** |
| NCAAFB plays | no | **still no — CFBD stays** |
| Breaking injury news | maybe RI | **no — RI is official-report only** |

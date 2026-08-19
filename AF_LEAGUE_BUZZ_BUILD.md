# AF League Buzz — Cross-Source Activity Aggregator (Build Brief)

**Status:** ready to build (extend, not greenfield) · **Prepared:** Jul 15, 2026
**For:** Claude Code in `F:\allfantasy-v2-main` · **Goal:** turn League Buzz into the living heartbeat of the control room — a real-time, cross-league, cross-source activity stream so the dashboard feels alive, without fabricating a single event.

**Read alongside:** `AF_CONTROL_ROOM_BUILD.md` (§5 — League Buzz is the "living" unlock), `AF_DATA_PROVENANCE_AUDIT.md` (note: its "League Buzz = EMPTY" row is **stale** — see §1), brand rules (no "AI", real numbers or nothing).

---

## 1. Audit first — what already exists (extend it)

**League Buzz is already partly real.** `app/api/shared/activity/route.ts` (recent) live-fetches **Sleeper transactions** — trades, waiver claims, free-agent adds/drops — for up to 6 of the viewer's in-season Sleeper leagues (last 2 weeks), sorts by time, caps the result, and falls back to an honest empty response. The dark feed `app/dashboard/components/warroom/LeagueActivityFeed.tsx` + light `ActivityFeed` both render it via `hooks/useActivityFeed.ts` (polls ~90s). The type is `ActivityFeedItem` in `lib/activity/placeholder.ts`.

So: **do not rebuild.** Extend the existing route into a multi-source aggregator, and DRY the Sleeper logic that's already there.

Two facts that shape the design:
- **Sleeper-imported and other imported leagues store only point-in-time snapshots** (`LegacyLeague`/`LegacyRoster`), *not* a transaction log — so historical cross-platform transaction feeds mostly don't exist to aggregate. Sleeper is live-fetchable (already done); native AF leagues have a real DB event trail; ESPN/Yahoo/MFL/Fantrax likely have **no** per-event feed → honest omission, not fabrication.
- The feed component already has icons for `trade / waiver / lineup / message / announcement` — the UI is ready for more types than the API currently emits.

---

## 2. Sources to add (each real or honestly omitted)

Aggregate into the one `ActivityFeedItem[]` the feed already consumes:

1. **Native AF league events (DB — cheap, high-value).** Audit the schema for and pull: completed **trades** (trade-proposal/execution models), **waiver claims**, commissioner **announcements**, and **league chat** messages (the table `LeagueChatInPanel`/messages uses). These are real DB rows for native leagues — the richest, fastest source.
2. **Injuries hitting the viewer's rosters (the emotional hook).** Cross-reference the viewer's rostered players (across leagues) against the live injury data already flowing through `lib/workers/api-chain.ts` (Rolling Insights / API-Sports). Emit an `injury`-type item ("CMC → Questionable — on 2 of your rosters") only when it actually affects a player they own. This is the single most "alive"-feeling signal.
3. **Standings / rank moves (optional, if cheap).** Native-league standing changes ("you moved to 2nd in Dynasty Kings") from real records.
4. **Sleeper transactions** — already live; keep, DRY into the multi-source shape.

Where a source has no real feed (imported non-Sleeper transaction history), **omit it silently** — never synthesize.

---

## 3. Performance — don't blow up the per-request fan-out
The route is polled ~90s per user and already fans out live Sleeper calls. Adding sources must stay cheap:
- Native DB events: a single indexed query per user (fast) — prefer this over live calls.
- Injuries: read from the **cached** api-chain / normalized injury tables, not a fresh provider hit per poll; join against cached rosters.
- Keep the Sleeper live-fetch bounded as it is (`MAX_LEAGUES_TO_CHECK`, `WEEKS_TO_CHECK`); cache its result briefly.
- If the combined fan-out is too heavy, introduce a short-TTL cache or a lightweight `recent_activity` materialized table refreshed by a cron — but only if measured need; don't over-engineer first.

## 4. Types + cleanup (build-checklist #4)
- Move `ActivityFeedItem` out of `lib/activity/placeholder.ts` into a properly named module (e.g. `lib/activity/types.ts`); the "placeholder" filename is misleading now that the feed is real. Update imports (route + hook + components).
- Extend the type union to cover `announcement | message | injury | standings` (the component's icon map already anticipates most).

## 5. The "living" feel (control-room UX)
- Keep/tighten the poll (or add SSE later — out of scope now); on new items, **slide them in** at the top (the concept mockup shows this) so the feed visibly breathes.
- Each item deep-links where it makes sense (a trade → the trade in that league; an injury → that player; an announcement → the league).
- Honest empty state stays for users with no activity yet ("Your league activity will show up here as it happens").

## 6. Build checklist (all seven)
1. **Visual** — richer multi-type feed (icons per type incl. injury), slide-in on new events.
2. **Backend** — multi-source aggregation in the existing route, DB queries + cached injury join.
3. **UI/UX** — real-time-ish feel, deep links, honest empty/loading states.
4. **Delete old** — rename the misleading `placeholder.ts`; remove any dead placeholder remnants.
5. **Fixes/gaps** — none introduced; keep the honest-fallback discipline.
6. **SEO/ASO** — n/a (authed surface); don't regress the marketing that sells it.
7. **On-brand** — no "AI"; real events only; premium, subtle motion.

## 7. Acceptance criteria
- [ ] Feed shows real events from **at least**: Sleeper transactions (existing) + native AF trades/waivers/announcements/chat + injuries-on-your-roster.
- [ ] Every item traces to a real source; no fabricated activity anywhere; sources with no real feed are omitted, not faked.
- [ ] Injury items appear **only** for players the viewer actually rosters.
- [ ] The endpoint stays performant under the ~90s poll (measure; cache if needed).
- [ ] New items slide in; deep links work; honest empty state for no-activity users.
- [ ] `ActivityFeedItem` lives in a non-"placeholder" module; type union covers all emitted types.
- [ ] No "AI" text; motion subtle.

## 8. Verification
- `npm run build` + `npm run typecheck` clean (ratchet: no new errors).
- Tests: aggregation merges + sorts multiple sources; injury item only emitted for owned players; empty-source → honest empty; performance guard (bounded fan-out).
- Manual: on a real account with a native league + a Sleeper league, confirm trades/waivers/announcements/chat/injuries all appear, correctly attributed, newest first.

## 9. Sequencing
1. Refactor the existing route into a source-merge shape + move the type out of `placeholder.ts`.
2. Add native-league DB events (biggest, cheapest win).
3. Add injuries-on-roster (the emotional hook) off cached data.
4. Slide-in UX + deep links.
5. Measure poll cost; add caching only if needed.

*Order: real + cheap first (DB events), then the injury hook, then polish. Keep the honest-fallback discipline the current route already models — it's why League Buzz can be trusted in a demo.*

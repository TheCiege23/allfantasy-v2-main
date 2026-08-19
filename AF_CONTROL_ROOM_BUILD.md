# AF Legacy Control Room — Build Brief

**Status:** ready to build (fixes) + design target (feel) · **Prepared:** Jul 15, 2026
**For:** Claude Code in `F:\allfantasy-v2-main` · **Goal:** make the AF Legacy dashboard feel like a living control room — a place where a user *sees* their whole fantasy world, gets real guidance, and fixes anything in one click — with **every number fed by real live data**, nothing fabricated.

**Read alongside:** `AF_DATA_PROVENANCE_AUDIT.md` (source of truth for what's live vs fake/empty — every fix below cites it), `af-control-room.html` (the visual/feel target), brand rules (no "AI", real numbers or nothing).

**What already exists (build on it, don't rebuild):** the war-room component set under `app/dashboard/components/warroom/*` (ActionCenter, ChampionshipGauge, InjuryImpactPanel, RecommendationTimeline, SeasonOutlook, PlatformPulseCard, LeagueActivityFeed, TodayTimeline, trajectory/*) and the universal board (`PriorityByPlatform`, `DynastyPlanetSearch`, `PortfolioAnalytics`, `LegacyModules`, `DashboardIntelligenceRail`). The control room is ~80% built as components — the work is **truth + live data + cohesion**, not greenfield.

---

## 0. Build-checklist (all seven)
1. **Visual** — the control-room layout/motion in `af-control-room.html` (status bar, hero metrics, Action Center, live Buzz feed, intelligence rail, launcher).
2. **Backend** — wire each surface to its real source (audit cites the file/route for every one).
3. **UI/UX** — living feel: real-time updates, subtle motion on new data, one-click "fix from here" routing, honest loading/empty states.
4. **Delete old code** — remove the dead/duplicate engines the audit names (see §4).
5. **Fixes & gaps** — close the ranked demo-risk items (§2).
6. **SEO + ASO** — dashboard is authed, but the marketing/landing that sells it stays optimized + on-brand.
7. **On-brand** — no "AI" anywhere customer-facing; premium navy/cyan; real numbers only.

---

## 1. The three problems to solve (in priority order)

**A. Kill the fabricated numbers** — a control room that shows fake data can't build trust, and it breaks "real numbers or nothing." (§2)
**B. Feed it live data, provably** — the "live data connected" promise must be *real*, and the data must actually refresh on a schedule. (§3)
**C. Make it feel alive** — motion, real-time updates, guidance, and one-click control, so it reads as a living command center not a static grid. (§5)

---

## 2. Kill fabricated / broken numbers (from the audit's ranked demo-risk list)

Each is a concrete, cited fix. Do these first — they're what a prospect would catch.

1. **Team Direction valuations are fake** (`server/api-route-modules/legacy/rankings/analyze/route.ts:540-542` — `getFantasyCalcValues()` returns an empty map, so every player gets a flat position+age price). **Fix:** wire the real `lib/hybrid-valuation.ts` / `canonicalPlayerValuations.ts` (already correct in every other tool) into this route. *(Small.)*
2. **Opponent Behavior letter grades = unbacked LLM.** Add a deterministic scoring function matching the disclosed weights (championship 35% / win% 25% / playoff 25% / consistency 15%); use the LLM for narrative only. *(Medium.)*
3. **"Live data connected" chip is hardcoded** (`DashboardHeader.tsx:100-105` — always green). **Fix:** wire to a real aggregated health check (see §3). *(Small.)*
4. **Trade Command Center shows two disagreeing acceptance %** — reconcile/clamp the LLM number to `acceptanceModel.score` or drop the duplicate. *(Small.)*
5. **Dead Archetype tile** (`LegacySnapshotCard.tsx:44,84` always `—`) — populate `managerArchetype` for real or remove the tile. *(Small.)*
6. **Championship count inconsistency** (`careerChampionships` vs `rank.championshipCount`) — unify to one source of truth. *(Small–Medium.)*

## 3. Feed it live data — provably (this is the "show real potential" requirement)

- **Real health chip / status bar.** Replace the hardcoded chip with a real aggregated health read (extend the existing `/api/health/data-providers`), showing per-feed status + last-updated timestamps (Scores, Injuries, News, Projections, Weather). This is the status bar in the mockup — it must reflect reality, green only when truly connected.
- **Fix the scheduled refresh gaps.** The audit found **22 cron paths in `vercel.json` with no route handler**, including `import-projections`, `import-rankings`, `data-freshness`, `health-check` — meaning **projections & rankings have no scheduled ingestion** (they only load on-demand). Build the missing route handlers (or trim `vercel.json` to match reality) so live data actually refreshes on a schedule. *(Medium.)*
- **Freshness signal everywhere.** Surface "updated Xs ago" on live modules (scores, injuries, matchup) so the room visibly breathes — sourced from the real `fetchWithChain` cache timestamps, not a fake clock.
- The core sports chain (`lib/workers/api-chain.ts` → Rolling Insights / API-Sports / TheSportsDB / CFBD / ClearSports + OpenWeatherMap) is **already real** — this is about proving it on screen and keeping it fresh.

## 4. Delete dead/duplicate code (build-checklist #4)
- **Dormant secondary ranking engine** `lib/ranking/*` (different XP scale, 5–10× off — can surface wrong numbers). Delete now that `lib/rank/*` is the sole source of truth.
- **Fake "yearly XP projection"** AI-lift multipliers (`computeLegacyRankPreview`) — dead but a landmine; delete or wire to a real model.
- **Dead `lib/workers/newsapi-ingestion.ts`** (never called; real pipeline goes through the api-chain).

## 5. Make it feel alive (the control-room feel — see `af-control-room.html`)

- **Status bar** with live feed chips (pulsing "live" dots) + a running clock + last-updated — the room is "on."
- **Hero metrics** that count up on load and update live: Championship Path (composite of real matchup win-probability + roster strength), "Needs you now" count, live leagues.
- **Action Center** = the "control" — the cross-league to-do (unset lineup, waiver run closing, pending trade), each with a **one-click route to fix it** (`PriorityByPlatform` is already real; make each item actionable and deep-linked).
- **League Buzz live feed** = the "living" heartbeat — a real-time stream of events across all leagues (trades, waivers, injuries affecting your rosters, chat, standings moves). **This requires building the cross-source activity aggregator** the audit flags as EMPTY (trades + waivers + chat + announcements + injury-on-your-roster). *(Large — the single biggest "living" unlock.)*
- **Intelligence rail (Chimmy)** — real guidance grounded in the already-real tools: start/sit edges (projection deltas), trade-value trends, injury handcuff alerts, season trajectory. Narrative only; numbers come from the real engines.
- **Motion discipline** — subtle: pulse on new data, slide-in feed items, count-ups. Premium, not busy (brand P3: stunning but simple).

## 6. Acceptance criteria
- [ ] No surface in the control room shows a fabricated number — every value traces to a source named in the provenance audit (or an honest empty state).
- [ ] The status bar reflects **real** feed health + last-updated; it can show a feed as down.
- [ ] Projections/rankings/freshness refresh on a real schedule (missing cron routes built or `vercel.json` trimmed).
- [ ] Team Direction uses real valuations; Opponent Behavior grade is deterministic; the two Trade acceptance %s agree; Archetype tile is real or gone; championship count is single-sourced.
- [ ] League Buzz shows a real, live cross-league activity stream (or a clearly honest empty state until the aggregator lands).
- [ ] Every Action Center item deep-links to the exact place to fix it.
- [ ] Dead engines (`lib/ranking/*`, yearly-XP projection, newsapi-ingestion) removed.
- [ ] No "AI" text on any customer-facing surface; premium navy/cyan; motion subtle.

## 7. Verification
- `npm run build` + `npm run typecheck` clean.
- Golden-path pass from a real imported account — screenshot the control room; confirm every number is real/honest-empty (doubles as Gate A evidence).
- Health chip test: kill a provider key in a test env → the chip must show that feed down, not green.

## 8. Sequencing
1. **§2 fixes** (fast, high-trust — kill fake numbers) + **§4 deletes**.
2. **§3 live-data proof** (health chip + missing crons + freshness).
3. **§5 feel** — motion/UX polish on the existing components, Action Center deep-links, intelligence rail.
4. **League Buzz aggregator** (the large item) — land it to complete the "living" heartbeat.

*Order matters: a control room that's honest + provably live first, then beautiful and alive. Fake-but-pretty is the one outcome to avoid.*

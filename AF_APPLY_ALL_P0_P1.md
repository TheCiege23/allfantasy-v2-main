# AllFantasy — Apply ALL P0 + P1 data changes (Claude Code master prompt)

Paste the block below into **Claude Code** in your `allfantasy-v2-main` repo. It applies every P0+P1
change in order, compiles after each step, does the DB migration safely, and **stops before deploy**
so you approve the push. All the design + code already exists in the repo (`cfbd.expanded.ts`,
`AF_DATA_EXPANSION_P0_P1_PACKAGE.md`).

---

```
Apply the P0 + P1 sports-data expansion. Full spec is in AF_DATA_EXPANSION_P0_P1_PACKAGE.md; the
finished CFBD provider is in cfbd.expanded.ts. Work in a new branch. Protect proven-live paths:
keep a backup of every file you replace, compile after EACH step, and STOP before pushing/deploying.

BRANCH: git checkout -b feat/nfl-ncaaf-data-expansion

STEP 1 — Config TTLs (safe, do first)
- In lib/workers/api-config.ts, add to API_CHAIN_TTLS: season_stats: 43200, weekly_stats: 900.
- npm run typecheck && npm run build. Must be clean before continuing.

STEP 2 — Expand CFBD provider (NCAAF roster/player pool + stats + standings + rankings)
- Back up lib/workers/providers/cfbd.ts -> cfbd.ts.bak
- Replace lib/workers/providers/cfbd.ts with the contents of cfbd.expanded.ts, then delete
  cfbd.expanded.ts.
- Confirm the CFBD endpoints used (/roster, /stats/player/season, /games/players, /records,
  /rankings) match the current CollegeFootballData API. Fix any field-name drift.
- npm run typecheck && npm run build. Must be clean.
- Smoke test: call the api-chain for sport 'ncaaf', dataType 'roster' and 'standings' for one FBS
  team; confirm real data returns and caches. Do NOT proceed if empty/erroring.

STEP 3 — API-Sports NFL fallbacks (standings + season stats) — see Package Change 3
- In @/lib/api-sports add fetchAPISportsStandings + fetchAPISportsPlayerStatistics (confirm exact
  paths/params against the API-Sports American-Football plan). Reuse existing auth/rate-limit code.
- In lib/workers/providers/api-sports.ts add 'standings' + 'season_stats' to `supports` and add the
  matching fetch cases, returning the SAME canonical shape CFBD returns for those types.
- npm run typecheck && npm run build clean. Verify: with Rolling Insights forced to fail, NFL
  standings + season stats still return via API-Sports.

STEP 4 — TheSportsDB PREMIUM live scores — see Package Change 4
- Update THESPORTSDB_API_KEY to the premium key (in .env locally AND Vercel Production env).
- Add a v2 premium fetch helper + livescore mapping in lib/workers/providers/thesportsdb.ts;
  add 'scores'/'live_game' to supports + fetch cases. CONFIRM v2 base URL + auth (path vs
  X-API-KEY header) in your TheSportsDB premium docs.
- In api-chain.ts, relax skipGameLikeFallbacks so 'scores'/'live_game' may fall back to TheSportsDB
  premium AFTER Rolling Insights (RI stays first; don't allow status-only providers).
- npm run typecheck && npm run build clean. Verify live scores populate from TheSportsDB when RI is
  forced to fail.

STEP 5 — Durable NCAAF storage + importer + one cron — see Package Change 5
- Prisma: add canonical NCAAF tables (NcaafPlayer, NcaafPlayerSeasonStat, NcaafPlayerGameStat) or
  extend existing player/stat tables with a sport discriminator — match the existing
  SportsPlayer/normalized-table pattern. Enforce sport isolation (NCAAF must never leak into NFL).
- Migration: prisma migrate dev to create + apply locally FIRST. Review the SQL. Only after it's
  verified locally, plan the prod migration (prisma migrate deploy) as a SEPARATE, explicit step —
  do not auto-run against prod without confirmation.
- Importer: add an NCAAF importer looping /teams/fbs -> apiChain.fetch roster/season_stats/
  weekly_stats, pivoting CFBD category/statType rows into per-player canonical rows, idempotent upsert.
- Coordinator + cron: wire into sports-data-import-coordinator as ONE cron; add a single vercel.json
  entry (currently 26/40 after the trim — room to spare). Roster+season daily, weekly stats hourly
  in-season (guard on season window).
- npm run typecheck && npm run build clean.

FINAL VERIFY (do not skip)
- Import 2-3 real FBS schools for the current season; confirm a genuine college player pool + stats
  persist and render in an NCAAF context. Assert NO NCAAF player appears in any NFL pool (add a
  cross-sport-leakage test). Confirm NFL standings/season-stats fallback + TheSportsDB live-score
  fallback both work with RI disabled.
- Show me: the git diff summary, build/typecheck results, the local migration SQL, and the smoke-test
  output. STOP. Do not push or deploy or run the prod migration until I say go.

REPORT honestly per step: source-complete / typecheck-pass / build-pass / migration-applied-locally /
runtime-verified — never claim done without the evidence above.
```

---

## Order of value if you'd rather stage it

- **Steps 1–2 alone** already give you real NCAAF data on-demand (the biggest single win). Safe to do first and ship.
- **Step 3** closes the NFL resilience gap. **Step 4** hardens live scores (best verified during a real slate). **Step 5** makes NCAAF durable + scheduled — the piece that makes it feel like an always-there product.

If you want me to write **Step 5's Prisma models + importer as finished code** (so your executor does even less thinking), say so — I'll read your schema + an existing importer and hand you ready files, same as I did for CFBD.

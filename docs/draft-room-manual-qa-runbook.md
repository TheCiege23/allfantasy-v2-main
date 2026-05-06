# Draft room — manual browser QA runbook (MVP)

**Audience:** App owner / QA after automated launch gate passes.

**Purpose:** Verify the **live** DraftRoom MVP in real browsers—complementing Vitest, lint, and launch-gate file checks. This document does **not** replace automated tests.

**Canonical live draft URL:** `/draft/room/[draftId]` (see `app/draft/room/[draftId]/page.tsx`). Avoid mock-only flows unless explicitly testing mock isolation.

**Normalized player data / provider QA:** In development, loading the draft pool logs `[draft-room normalized player data]` for pool diagnostics when the API returns `normalizedPlayerDataDiagnostics`. Optional `?debugPlayerData=1` on `GET /api/leagues/[leagueId]/draft/pool` forces diagnostic attachment outside dev. Confirm list rows/cards show headshots when TSDB (or other fallbacks) supply `unified.unified.headshotUrl` after RI gaps.

**Board / queue / detail consistency:** After picks land, board cells should show the same fallback headshot/injury as the pool when `playerId` matches a pool row. Queue rows should show ADP and **AI ADP** separately, plus injury/experience chips when available — without changing queue order (drag/up/down still reorders the same `QueueEntry[]`). Player detail modal headshot/injury should match the selected pool row.

---

## 1. Preconditions

| Requirement | Notes |
|-------------|--------|
| **Neon / Postgres** | `DATABASE_URL` in `.env` (pooler URL for app; optional `DIRECT_URL` for migrations). |
| **Prisma client** | `npm run prisma:generate` (also runs on `postinstall`). |
| **Schema on DB** | `npm run db:migrate` (dev) or `npm run db:migrate:deploy` (deploy)—use the workflow your environment already uses. |
| **Auth** | `NEXTAUTH_SECRET` set; you can sign in as real test users. |
| **Dev server** | `npm run dev` (Windows; see `package.json` for `dev:stable`, `dev:unix`, ports). Default Next port is **3000** unless overridden. |
| **Draft session** | At least one league with an **in-progress** (or startable) **`DraftSession`** and roster slots—see §3. |
| **Player pool** | Pool rows + ADP for your test sport(s) (resolved via `getResolvedDraftPoolForLeague` paths). |
| **CRON_SECRET** | Only needed to **manually** hit `/api/cron/recompute-allfantasy-adp` (§5.R)—not for normal draft picks. |

**Env checklist (no secret values printed):**

```bash
npm run check:draft-env
```

Keys documented in `scripts/draft-env-check.mjs` include `DATABASE_URL`, `NEXTAUTH_SECRET`, `CRON_SECRET`, AllFantasy ADP public flags, optional provider keys, etc.

---

## 2. Local run — what exists in the repo

### 2.1 Commands (real scripts only)

| Step | Command |
|------|---------|
| Install | `npm install` (triggers Prisma generate via `postinstall`). |
| DB migrate (dev) | `npm run db:migrate` |
| DB push (prototyping) | `npm run db:push` |
| Prisma Studio | `npm run db:studio` |
| Seed (minimal platform data) | `npm run seed` → runs `tsx prisma/seed.ts` |
| Dev server | `npm run dev` |
| Post-draft **read-only** audit | `npm run smoke:full-draft -- --league=<leagueId>` |
| Env checklist | `npm run check:draft-env` |

### 2.2 What `npm run seed` does

`prisma/seed.ts` upserts a **single** test user (`test@example.com`), a **Sleeper-style** test league/team/season snapshot. It does **not** by itself provision a full **live `DraftSession`** wired to `/draft/room/[draftId]` for multi-manager QA. Treat it as **minimal DB bootstrap**, not a complete draft-room scenario.

### 2.3 Other seeds / smokes (secondary)

| Script | Role |
|--------|------|
| `npm run seed:test-adp-drafts` | Controlled **completed** test drafts for **AI ADP** aggregation (`sessionKind='test'`). Useful for ADP/cron validation; **not** the primary “live draft in browser” setup. |
| `npm run smoke:full-draft -- --league=<id>` | **Read-only** audit after a draft (picks, chat events, integrity). Good **after** manual QA to inspect consistency. |

### 2.4 Manual UI setup path (when no dedicated QA seed)

1. Sign in (test users or real accounts).
2. Create or open a **league** with draft settings matching your scenario (sport, snake/redraft, team count, timer).
3. Ensure **multiple rosters/managers** are assigned (invite second user or use second browser profile).
4. **Start** the draft from commissioner / league flow so a **`DraftSession`** exists and you obtain a **`draftId`**.
5. Open **`/draft/room/<draftId>`** (or navigate from league UI).

**Dashboard → league hub (embedded):** On **`/dashboard`**, click a league in **My Leagues**. The URL should become **`/dashboard?leagueId=<id>`**. The **center panel** loads the league hub in an iframe (**`/league/[id]?embed=1`**) without duplicate global app chrome. Chat stays on the left (defaults to league chat) and My Leagues stays on the right.

**Draft from embedded hub:** From that center hub, use **Draft tab**, **War Room → Enter draft room**, **dispersal banner**, or **Settings → dispersal “Open draft room”** when applicable. Each should open a **full-screen draft overlay** on top of the dashboard (URL gains **`draftOverlay=1`** and **`draftId`** or **`dispersalDraftId`**). **X** returns to **`/dashboard?leagueId=…`**; **Home** returns to **`/dashboard`**. Opening **`/league/[id]`** directly (no `embed`) still uses normal full-page navigation.

Full-page league hub draft links (**`/league/[id]/draft`**, etc.) behave as before when not embedded.

Document your **league name**, **`draftId`**, **`leagueId`**, sport, timer, and users in §4 so runs are repeatable.

### 2.5 Troubleshooting — Pre-Draft Checklist blocks draft start

The draft engine intentionally refuses to start until validation passes (`DraftValidationOrchestrator`). Typical failures:

| Check | What it means | What to do |
|-------|----------------|------------|
| Roster Configuration | No persisted roster slot layout on the league row | As **commissioner**, in the checklist modal click **Fix** next to Roster Configuration — this applies default roster slots from the league’s sport template. Then **Refresh**. |
| Scoring Settings | No scoring format / preset on the league | Click **Fix** next to Scoring Settings — applies the default scoring preset for that sport. Then **Refresh**. |

New leagues created after this fix should receive roster + scoring defaults automatically during post-create bootstrap. **Do not** bypass or disable the checklist.

If fixes still fail, verify the league row in admin/tools: `League.scoring` / `scoringPresetId`, and roster slots derived from the roster template. Do not hand-edit production DB without understanding downstream scoring/roster engines.

### 2.6 Troubleshooting — Top bar “on the clock” vs player card **Not your pick**

Symptoms: timer counts down, pool loads, pick label matches reality, but opening a player shows **Not your pick** and only **Queue** — no **Draft / Make pick**.

Capture for engineering:

| Artifact | Why it matters |
|----------|----------------|
| Current overall pick (`#` from header / session) | Confirms server clock vs UI |
| Top-bar manager / roster label | Comes from `session.currentPick` display |
| Selected player name/id | Rules out wrong candidate player |
| Dev console — `[draft-room] pick eligibility diagnostic (dev)` | Non-production only: trimmed roster ids, `denialReason`, `pickSubmitting`, overnight pause flag, roster-configuration gate |
| Network — `POST /api/leagues/[leagueId]/draft/pick` | After **Draft** works — validates payload and race handling |

### 2.7 Troubleshooting — **Rookies only** empty

When **Rookies only** shows **no rows** or **metadata unavailable**:

| Check | Interpretation |
|-------|----------------|
| Dev console — `[draft-room] rookies-only empty — signal diagnostics` | Non-production: counts `yearsExp`, draft-year hints, sample rows — distinguishes **data gap** vs **UI/filter bug** |
| If diagnostics show **zero** rookie signals across hundreds of NFL rows | Treat as **upstream pool/import gap** (populate `years_exp` / flags on ingest). |
| If diagnostics show non-zero signals but UI stays empty | File a **UI/filter** bug — mapping from pool rows to `PlayerEntry` may be dropping fields. |

#### Rookies (NFL)

NFL rookies in the draft pool should resolve from:

1. **Imported / DB explicit fields** when present on the player row (`isRookie`, `years_exp`, `draftYear`, etc.).
2. Otherwise **`Sleeper years_exp === 0`**, including via **`SportsDataCache`** key `sleeper:nfl:yearsexp:compact:v1` when live Sleeper is cold.

If rookies are still missing after confirming filters:

- Run **`npm run audit:ri-mapping`** (or your env’s **provider coverage audit** for NFL) to inspect identity coverage.
- Inspect the Sleeper **`years_exp`** cache row in `SportsDataCache` for freshness.
- Verify **player id cross-links** between Rolling Insights / pool ids and Sleeper ids (`PlayerIdentityMap`, pool `external_source_id`).

For **NBA / MLB / NHL / NCAAB** pools: if stats or live-box columns look empty, run **`npm run data:audit-provider-coverage`** for that sport before assuming a UI bug — missing ingestion shows up as gaps in `stats`/`projections` JSON on cache rows.

For **NCAA football** freshman/class filters: verify **`class`** is present on imported rows (`npm run data:audit-provider-coverage -- --sport NCAAFB --missing class`). NCAA football does **not** use Sleeper `years_exp` for freshman eligibility.

If **Freshmen / Underclassmen / Draft eligible** filters look empty, run **`--missing class`** first; if **team D/ST or schedule-driven scoring** looks thin, run **`--missing team_stats`** or **`--missing schedule`** for **`NCAAFB`** to confirm cached JSON carries Rolling Insights aggregates before blaming UI.

For **NCAA football schedules**, venue/geo fields may be **null** on some seasons — that is **not** a failed import; confirm **`team-info`** enrichment separately.

For **soccer (SOCCER / EPL / LALIGA / SERIEA)** pools, use **`npm run data:audit-provider-coverage -- --sport SOCCER --league EPL`** when debugging competition-specific gaps. **`replaced`** schedule rows should **not** be expected to drive live scoring; **relegated** clubs may have **`regular_season: null`** on team-stats payloads.

---

## 3. Recommended browsers / devices

- **Desktop Chrome** (primary).
- **Edge or Firefox** (secondary—layout/timer quirks).
- **Responsive mode** or real phone: narrow viewport for §5.P.
- **Two windows or profiles** for **two managers** (§5.B).

---

## 4. Test data setup (fill before running)

Record values you actually use:

| Field | Your value |
|-------|------------|
| League display name | |
| `leagueId` | |
| `draftId` | |
| Sport | |
| Draft type (snake / auction / …) | |
| Team count | |
| Timer seconds | |
| Manager A (email / role) | |
| Manager B (email / role) | |
| AF Pro user (for §5.F/G) | Y/N |
| NPC/orphan team (for §5.H) | Y/N |
| Pool notes (NFL + one non-NFL if available) | |

---

## 5. Manual QA scenarios (checklist)

Check each box when verified.

### A. Initial load

- [ ] Open **`/draft/room/<draftId>`** for the test league.
- [ ] Draft board renders; current pick / order visible.
- [ ] Player pool loads; no perpetual loading spinner.
- [ ] Top bar / timer area visible.
- [ ] “On the clock” team/roster is identifiable.
- [ ] **ADP** and **AI ADP** show as **separate** columns/labels where enabled.
- [ ] No accidental **mock-demo** UI for **live** sessions (live vs mock is gated in `DraftRoomPage`—confirm you used **live** `draftId`).

### UX. Draft board & queue hierarchy (snake / linear live room, premium redraft)

- [ ] Draft board shows **one** team/manager header row aligned with pick columns (snake/linear: no separate avatar strip above the grid; auction may still show the overview strip).
- [ ] Round labels remain on the left; on-clock / current pick highlight still obvious.
- [ ] **Queue** tab: search, filters, and the queued player list are visible **without** expanding secondary sections.
- [ ] **Draft Intelligence** is **collapsed by default** (expand to confirm recommendations still render).
- [ ] **Queue & AI options** is **collapsed by default**; after expanding, AI reorder + autopick / away toggles still work.
- [ ] **Global Chimmy** floating action button is **not** shown on `/draft/*` (use in-room helper / tabs instead — avoids covering the board or queue rail).
- [ ] **War Room** trigger sits **bottom-left** on premium redraft snake so it does not stack on the right-hand queue corner.

### Player pool — rookies, positions, ADP (data readiness)

- [ ] **Rookies only** uses explicit + inferred rookie signals (`years_exp`, flags, draft year vs season) — not a dead-end when metadata exists on rows.
- [ ] If **no rookies** appear with Rookies only on, the empty state explains **why** (no rookie metadata vs none for this season vs other filters).
- [ ] **Imported ADP** (**ADP** column) stays separate from **AllFantasy / AI ADP** — verify both labels and tooltips.
- [ ] When AI ADP has no snapshot yet, copy reads **“Not enough AllFantasy draft data yet”** (not alarming “data not ready”), without overwriting system ADP.
- [ ] **Low sample** dot on AI ADP still appears when the segment is thin.
- [ ] Position pills: **K** counts **PK/K**, **DST** counts **DEF/D/ST**, **FLEX** counts **RB/WR/TE** — spot-check counts vs visible rows.
- [ ] If a major NFL position pill shows **0** but the pool clearly has players, treat as an **import / normalization gap** (dev-only console diagnostics may log counts).

### B. Two-manager live pick flow

- [ ] Manager **A** in browser 1; Manager **B** in browser 2.
- [ ] **A** on clock; **A** submits a pick.
- [ ] Pick appears on board; player unavailable / removed from pool for others.
- [ ] Draft chat shows pick event (if chat enabled).
- [ ] Timer resets; **B** becomes on clock.
- [ ] **B**’s session updates (poll / live-sync / SSE)—**B** can pick next.

### C. Stale / race refresh

- [ ] Same manager: **two tabs**; submit pick in tab 1.
- [ ] Tab 2: attempt stale submit or refresh—UI shows safe handling (error/recovery copy).
- [ ] Session / queue / pool refresh—**no duplicate** pick on board.

### D. Timer / autopick

- [ ] Short timer (or wait until expiry).
- [ ] Autopick fires; player selected; timer resets; next manager on clock.
- [ ] Chat/event reflects autopick if supported.

### E. Queue autopick

- [ ] Queue players while on clock (for the roster that will autopick).
- [ ] Let timer expire.
- [ ] First **available** queued player is taken; skip if already drafted.

### F. AF Pro AI queue

- [ ] AF Pro user; enable **AI manage draft queue** on roster settings (see product copy).
- [ ] Run **AI reorder**; order **persists** after refresh.
- [ ] Locked rows stay fixed; autopick respects persisted order.
- [ ] Disable flag; reorder no longer persists as AF-managed behavior.

### G. Non–AF Pro AI queue

- [ ] Non-Pro user attempts AI reorder.
- [ ] No unauthorized persist; suggestion-only or permission messaging.

### H. NPC / orphan autopick

- [ ] NPC-controlled team on clock (if commissioner UI supports assignment).
- [ ] Deterministic pick (no LLM wall-clock requirement); valid player/sport.

### I. Draft pick trade (future pick)

- [ ] Trade an **unpicked** pick to another manager **before** that clock event (per product rules).
- [ ] When pick comes due, **new owner** acts; metadata shows trade overlay if UI exposes it.

### J. Already-picked slot

- [ ] Confirm UI/API does not allow trading **completed** pick slots via draft-pick trade flow (normal player trades later).

### K. Draft completion

- [ ] Final picks complete draft; status **completed**; board locks.
- [ ] No spurious next timer.
- [ ] Recap / completion messaging if implemented.

### L. Roster assignment

- [ ] Post-draft: players on correct rosters; starters vs bench per **`buildLineupSectionsFromPicks`** behavior (IR/taxi/devy not auto-filled at finalize—see `docs/live-draft-engine-map.md`).

### M. Sport stat table (Sleeper pool mode)

- [ ] **NFL:** offense columns; switch IDP filter → defensive columns.
- [ ] **Non-NFL** (if pool exists): appropriate stat headers; **—** for missing stats.
- [ ] Sort by stat; ADP vs AI ADP remain distinct.

### N. Search / filter

- [ ] Name search; position / team filters; drafted players handled correctly.

### N2. Experience / rookie vs veteran (unified model)

- [ ] **Pro leagues (NFL/NBA/MLB/NHL):** rookie vs veteran reflects **`resolvePlayerExperience`** (`lib/player-data/playerExperience.ts`) — unknown is acceptable when DB payloads lack fields; do not assume vendor APIs match Neon without auditing imports.
- [ ] **NFL:** Sleeper-style **`years_exp`** remains the usual fallback when Rolling Insights JSON does not determine experience (`resolveNflRookieSource` / pool `yearsExp`).
- [ ] **NCAAF/NCAAB:** class / freshman / draft-eligible behavior uses **college class**, not Sleeper `years_exp`.
- [ ] Optional filters (**Rookies**, **Veterans**, taxi/devy where surfaced): toggling does not break pick buttons or pool load.

Read-only DB diagnostics:

```bash
npm run data:audit-player-experience -- --sport NFL --limit 10
npm run data:audit-player-experience -- --sport NBA --missing experience --limit 10
```

See `docs/player-experience-source-priority.md`.

### O. Draft chat

- [ ] Pick messages; manual chat if enabled; refresh—no obvious duplicate spam.

### P. Responsive / mobile

- [ ] Board + pool + primary actions usable at mobile width.

### Q. Refresh / disconnect recovery

- [ ] Hard refresh mid-draft—state matches server.
- [ ] Background tab—timer/server state coherent when returning.

### R. Cron smoke (optional)

- [ ] `GET /api/cron/recompute-allfantasy-adp` **without** secret → **401**.
- [ ] With `Authorization: Bearer <CRON_SECRET>` only on a **safe** environment—see `docs/draft-launch-gate.md`.

### S. Unified player data parity (Draft / Waivers / Roster)

- [ ] Draft pool **player card / panel** shows the same **identity + stat snapshot** shape users see elsewhere for that sport (via `buildUnifiedPlayerProductView` / `getPlayerDataForSurface`).
- [ ] **Waiver wire** rows: image, name, team, position, injury/status, projections/stats—no Sleeper-only staleness when `sports_players` cache has Rolling Insights data.
- [ ] **Roster** starters/bench rows align with that identity for the same `SportsPlayerRecord` ids.
- [ ] **NCAAF:** college **class** / freshman / draft-eligible signals visible in devy or college-variant leagues (Rolling Insights `class`, not Sleeper `years_exp`).
- [ ] **SOCCER:** **EPL / LALIGA / SERIEA** hint plus goalkeeper vs outfield grouping where league/competition applies.
- [ ] **NFL rookies:** rookie UX follows **`years_exp` Sleeper fallback** when RI docs omit rookie fields (`resolveNflRookieSource`).

Read-only diagnostics (DB/import only—no live RI HTTP):

```bash
npm run data:audit-player-surfaces -- --surface draft --sport NFL --limit 5
npm run data:audit-player-surfaces -- --surface waivers --sport NCAAF --missing class --limit 5
npm run data:audit-player-surfaces -- --surface roster --sport SOCCER --league EPL --limit 5
npm run data:audit-player-experience -- --sport NFL --limit 10
npm run data:audit-provider-gaps -- --sport NFL --surface draft --domain stats --limit 10
```

See `docs/player-data-integration-map.md`, `docs/provider-fallback-system.md`.

---

## 6. Reset / recovery

- **Soft:** Navigate away and back to `/draft/room/<draftId>`; ensure session refetches.
- **New draft:** Create a new league/draft from commissioner flows if the session is corrupted—**no** repo-standard “reset draft only” CLI was audited for this runbook.
- **DB:** Use Prisma Studio (`npm run db:studio`) **carefully** on non-production; destructive resets are **not** scripted here.

---

## 7. Issue log template

Copy a row per bug:

| Field | Value |
|-------|--------|
| **Scenario** | (e.g. “B — two-manager pick”) |
| **Browser / device** | |
| **User / team** | |
| **Expected** | |
| **Actual** | |
| **Screenshot / video** | (link or path) |
| **Console errors** | |
| **Failed network request** | (URL + status) |
| **Severity** | Blocker / High / Medium / Low |
| **Repro steps** | 1. … 2. … |
| **Notes** | |

---

## 8. Optional future: dedicated QA seed data

**Not implemented in this pass.** If you add a seed later, recommended contents:

- One **NFL redraft** league + one **non-NFL** league.
- **4** teams, **2** human-test users, **1** AF Pro entitlement, **1** NPC/orphan slot.
- Short **timer**; minimal **`DraftSession`** + **`DraftQueue.order`** rows.
- Pool rows with **ADP**, **AI ADP**, and **display.stats** for stat-column QA.

Track as a dedicated ticket: **“Create draft-room QA seed script.”**

---

## 9. Related docs

- `docs/player-data-integration-map.md` — unified player row → Draft / Waivers / Roster / AI.
- `docs/live-draft-engine-map.md` — engine, routes, known gaps (web push, `DraftQueueEntry`, typecheck).
- `docs/draft-launch-gate.md` — automated gate commands, cron curl example, env concepts.

---

*After automated launch gate tests pass, execute this runbook in the browser before treating the DraftRoom MVP as production-ready.*

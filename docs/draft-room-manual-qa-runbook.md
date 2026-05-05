# Draft room — manual browser QA runbook (MVP)

**Audience:** App owner / QA after automated launch gate passes.

**Purpose:** Verify the **live** DraftRoom MVP in real browsers—complementing Vitest, lint, and launch-gate file checks. This document does **not** replace automated tests.

**Canonical live draft URL:** `/draft/room/[draftId]` (see `app/draft/room/[draftId]/page.tsx`). Avoid mock-only flows unless explicitly testing mock isolation.

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

Document your **league name**, **`draftId`**, **`leagueId`**, sport, timer, and users in §4 so runs are repeatable.

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

- `docs/live-draft-engine-map.md` — engine, routes, known gaps (web push, `DraftQueueEntry`, typecheck).
- `docs/draft-launch-gate.md` — automated gate commands, cron curl example, env concepts.

---

*After automated launch gate tests pass, execute this runbook in the browser before treating the DraftRoom MVP as production-ready.*

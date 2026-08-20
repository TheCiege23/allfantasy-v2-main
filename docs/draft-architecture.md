# Draft architecture — source of truth (Phase 5D audit)

This document defines **which draft stack is authoritative** for AllFantasy league drafts, which paths are **legacy or display-only**, and what **not** to extend for new product work.

## Canonical source of truth (league live drafts)

**Authoritative persistence:** Prisma models **`DraftSession`** and **`DraftPick`** (plus league-scoped settings JSON / UI settings tables used by `DraftSessionService`).

**Primary write path:** `lib/live-draft-engine/PickSubmissionService.ts` → **`submitPick()`**  
**Primary read / snapshot:** `lib/live-draft-engine/DraftSessionService.ts` → **`buildSessionSnapshot()`**

**Production HTTP surface (preferred):**

| Area | Path / module |
|------|-----------------|
| Session + automation ticks | `GET /api/leagues/[leagueId]/draft/session` |
| User pick | `POST /api/leagues/[leagueId]/draft/pick` |
| Client autopick / expired helper | `POST /api/leagues/[leagueId]/draft/autopick-expired` |
| Commissioner controls | `POST /api/leagues/[leagueId]/draft/controls` |
| Pool, queue, chat, auction | `/api/leagues/[leagueId]/draft/*` siblings |
| Server timer progression (no tab open) | `GET /api/cron/draft-expired-timers` (Bearer `CRON_SECRET`) |

**Primary app routes:**

- **`/league/[leagueId]/draft`** — upserts `DraftSession`, redirects to **`/drafts/[draftSessionId]`** (canonical URL for live snake UX).
- **`/drafts/[draftId]`** — full-screen live room; seeds `DraftRoomPageClient` via `DraftBoard` + `buildSessionSnapshot`.
- **`/draft/live/[draftId]`** — resolves `DraftSession` id or legacy `leagueId` param, redirects to `/drafts/...`.
- **`/draft/[draftId]`** — router: mock → mock-draft; auction/lottery stay on `/draft/...`; **live snake** redirects to `/drafts/...`.
- **`/draft/room/[draftId]`** — **live** redirects to `/drafts/...`; **mock** renders `DraftBoard kind="mock"` only.

**Client:** `components/app/draft-room/DraftRoomPageClient.tsx` — polls/refreshes **`/api/leagues/.../draft/session`**; pick submission hits **`.../draft/pick`**. Do not replace with a second pick writer.

---

## Legacy DraftRoom row store (mock + old chrome)

**Tables:** `DraftRoomStateRow`, `DraftRoomPickRecord`, `DraftRoomUserQueue`, `DraftAutopickSetting`, `DraftRoomChatMessage` (session keys `mock:…` / `live:…` in `lib/draft/session-key.ts`).

**Still authoritative for:** **mock** Sleeper-style rooms created via **`POST /api/draft/room/create`** and driven by **`app/draft/components/DraftShell.tsx`** + **`executeDraftPick`** (mock branch only).

**`executeDraftPick` behavior (important):**

- **`live:`** session keys → **delegates to `submitPick`** (canonical). No writes to `DraftRoomPickRecord` / `DraftRoomStateRow` on that branch.
- **`mock:`** → **`assertLegacyDraftRuntimeWriteAllowed`** then legacy Prisma transaction on DraftRoom tables.

**Risk:** Any code path that wrote **live** picks only to DraftRoom tables would diverge from the board; guards and route tests exist to prevent that. Prefer **`submitPick`** for all new live features.

---

## SSE / DraftWorker / “worker API” stack

| Piece | Role |
|-------|------|
| `lib/workers/draft-worker.ts` **`DraftWorker`** | In-process engine: reads/writes **canonical** `DraftSession`, publishes ephemeral events to **`draftStreamStore`**. |
| `lib/draft/draft-stream-store.ts` | In-memory pub/sub for SSE consumers on a single Node instance — **not** a second source of truth. |
| `GET /api/draft/[draftId]/stream` | SSE feed for **BigScreenBoard** and similar; events are **best-effort / display**; authoritative state remains **`buildSessionSnapshot`**. |
| `GET /api/draft/[draftId]/state` | JSON state for lottery/big screen — backed by **DraftWorker** / snapshot patterns. |
| `POST /api/draft/worker` | **Mock-only** legacy autopick (`mock:` + `DraftRoomStateRow`); **`live:` → 410** (Phase 5E). Pool uses mock room sport. |

**Caveat:** SSE store does not survive multi-instance deploys unless replaced with shared realtime; treat as **auxiliary UX**, not persistence.

---

## AI / queue / helpers

| Surface | Classification |
|---------|------------------|
| `POST /api/leagues/[leagueId]/draft/queue`, `.../queue/ai-reorder` | **Canonical** — persistence tied to league draft UX. |
| `GET /api/leagues/[leagueId]/draft/assistant-context`, `.../ai-pick` | **Canonical** — assists canonical room. |
| `/api/draft/recommend`, `/api/draft/live-brain`, `/api/draft-ai/*`, `/api/ai/draft/*` | **Helper / tool** — must not become a parallel pick writer for league drafts. |

---

## Timer progression strategy

1. **Client** — optional fast-path: `autopick-expired`, polling `draft/session`.  
2. **Server** — **`/api/cron/draft-expired-timers`** uses `DraftSession` timers, locks, **`submitPick`**, and existing automation ticks (`expiredDraftTimerCron`).

---

## What not to use for new league-draft features

- Do **not** add new **live** pick writes via **`DraftRoomPickRecord`** / **`DraftRoomStateRow`**.
- Do **not** route production league navigation to **`DraftShell`** for live snake (use **`/drafts/[draftSessionId]`**).
- Do **not** treat **`/api/draft/[draftId]/stream`** payloads as durable state without reconciling to **`buildSessionSnapshot`**.
- **`POST /api/draft/worker`** — **mock-only** (Phase 5E): rejects `live:` with **410**; pool uses **`MockDraftRoom.sport`** (see Phase 5E below).

---

## Phase 5E — Caller audit & legacy containment (completed)

### Hard rule for new work

**All new live league draft writes must go through `DraftSession` + `PickSubmissionService.submitPick()`** (typically via `POST /api/leagues/[leagueId]/draft/pick` or server automation that calls the same service). Do not add parallel live writers on `DraftRoom*` tables.

### Caller audit (repo `app/`, `components/`, `lib/` — excluding tests / `.claude` worktrees)

| Symbol / route | Callers (production-relevant) | Classification | Production navigation? | Can write live canonical? | Risk |
|----------------|------------------------------|----------------|-------------------------|---------------------------|------|
| `POST /api/draft/worker` | `app/draft/components/DraftShell.tsx` | Legacy | only via legacy shell / mock | **No** (410 for `live:`; mock only) | was high → **contained** |
| `DraftShell` | self + `DraftRoom.tsx` | Legacy UI | `/draft/room/*` mock; live redirects to `/drafts/` | picks blocked at API for `live:` | medium |
| `DraftRoom` | `app/draft/room/[draftId]/page.tsx` | Wrapper | mock inline; live redirect | no direct writes | low |
| `draftRoomStateRow` / `draftRoomPickRecord` | `DraftShell` API stack, `execute-pick` mock, `room/state`, `room/start`, timer routes; Chimmy alerts use **`loadChimmyDraftSignalSlice`** (DraftSession first, legacy row fallback + `draft_signal_legacy_draft_room_row` log) | Legacy store | mock + adapters | live picks via `executeDraftPick` → **submitPick** only; worker/cpu **mock-only** | medium |
| `sessionKeyLive` | `lib/draft/session-key.ts`, `app/api/draft/room/state`, (formerly `draft/picks`) | Key helper | adapter + tests | no direct writes from key alone | low |
| `draftStreamStore` | `DraftWorker`, `GET …/draft/[id]/stream` | Auxiliary | big screen | **no** DB writes via store | medium |
| `GET /api/draft/room/state` | `DraftShell` | Adapter | legacy shell | read-only | low |
| `GET /api/draft/[draftId]/state` | `BigScreenBoard` | Auxiliary | `/draft/[id]/bigscreen` | read-only (`DraftWorker`) | low |
| `GET /api/draft/[draftId]/stream` | `BigScreenBoard` | Auxiliary | same | no writes | low |
| `executeDraftPick` | `pick/make`, `worker`, `cpu-pick` | Hybrid | mock paths only for worker/cpu; `pick/make` rejects `live:` | live → **submitPick** inside function | low (API-layer blocks added) |
| `legacy-runtime-write-guard` | `execute-pick` mock branch | Guard | — | blocks mistaken live DraftRoom writes | low |
| `POST /api/draft/picks` | *(no in-repo fetch callers found)* | **Retired** | dead / external? | **No** — returns **410** always | was medium → **retired** |
| `POST /api/draft/pick/make` | `DraftShell` | Legacy | mock shell | **No** for `live:` (**410**) | contained |
| `POST /api/draft/mock/cpu-pick` | `DraftShell` (mock loop) | Legacy | mock | **No** for `live:` (**410**); sport from room | contained |
| `POST /api/draft/pick/undo` | *(grep app draft)* | Hybrid | unknown | live → `undoLastPick` (**canonical**) | low |
| `POST /api/draft/timer/*` | legacy shell | Hybrid | unknown | live → `pauseDraftSession` / etc. (**canonical**) | low |

### Containment implemented (Phase 5E)

| Route | Behavior |
|-------|----------|
| `POST /api/draft/worker` | **`live:` → 410**; **`mock:`** requires existing `MockDraftRoom`; autopick pool uses **room sport** (7-sport `normalizeToSupportedSport`), not NFL-only. |
| `POST /api/draft/pick/make` | **`live:` → 410**; mock continues via `executeDraftPick`. |
| `POST /api/draft/mock/cpu-pick` | **`live:` → 410**; CPU pool uses **room sport**. |
| `POST /api/draft/picks` | **Always 410** — use `POST /api/leagues/{leagueId}/draft/pick`. |

### Big screen / SSE (unchanged behavior; documentation only)

- **`BigScreenBoard`**, **`draftStreamStore`**, **`GET …/stream`**, **`GET …/[draftId]/state`** — display / ambient; **no** pick persistence through SSE. Initial load refetches JSON state from **`DraftWorker`** (canonical session).

---

## Phase 5F — Legacy telemetry + Chimmy draft signals (completed)

### Telemetry (`lib/draft/legacy-draft-route-telemetry.ts`)

When these routes return **410** (or always for retired picks), they emit **`logStructured('warn', 'draft_health', 'legacy_draft_route_blocked', meta)`** with **no PII**:

| Field | Purpose |
|-------|--------|
| `route` | e.g. `/api/draft/worker` |
| `reason` | `legacy_worker_live_blocked`, `legacy_pick_make_blocked`, `legacy_draft_picks_route_deprecated`, `legacy_cpu_pick_live_blocked` |
| `httpMethod` | `POST` |
| `authenticated` | whether a session user was present |
| `sessionKeyShape` | `live` \| `mock` \| `none` \| `invalid` — **never** the full `sessionId` |

Aggregate in Vercel log drains on `source":"draft_health"` + `event":"legacy_draft_route_blocked"`.

### Chimmy alerts (`lib/chimmy-alerts/chimmyDraftSignals.ts`)

- **Primary:** `loadChimmyDraftSignalSlice` reads **`DraftSession`** + `LeagueTeam.legacyRosterId` and **`resolveCurrentOnTheClock`** for `onTheClock` / `draftStartingSoon` (snake + linear; **auction** skips on-the-clock in this slice).
- **Fallback:** if no `DraftSession` row exists, reads **`DraftRoomStateRow`** (`leagueId`) and emits **`draft_health` / `chimmy_legacy_draft_signal_fallback`** with `leagueId` + legacy status code in `reason`.
- **`ChimmyAlertSignalHydrator`** calls this helper only — it **no longer** queries `draftRoomStateRow` inline.

---

## Phase 5G — Draft observability + legacy traffic monitoring (completed)

- **Module:** `lib/draft/observability/*` — typed **`DraftHealthEventId`**, **`emitDraftHealth`**, payload sanitization, summarizers, alert-threshold constants.
- **Cron:** `processExpiredDraftTimersBatch` emits **`draft_cron_batch_started` / `draft_cron_batch_completed`**; per-league processing uses **`draft_expired_timer_processed`**, **`draft_queue_pick_used`**, **`draft_bpa_fallback_used`**, **`draft_autopick_skipped`**, **`draft_auction_automation_processed`** (no player names in logs).
- **Locks:** `draft_lock` logs include **`draftEvent: draft_lock_busy`** for contention.
- **Live sync:** `GET …/draft/events` logs **`draft_live_sync_snapshot_failed`** if `buildSessionSnapshot` throws.
- **Session repair:** slot-order repair emits **`draft_session_slot_order_repaired`**.
- **Picks:** `submitPick` emits **`draft_pick_stale_overall`** on `DRAFT_PICK_STALE_OVERALL`.
- **Docs:** `docs/draft-observability.md` — full taxonomy + interpretation + future alerts.

## Related code comments

Legacy routes and workers carry **@deprecated** or **Phase 5D/5E/5F/5G** file-level notes pointing here. When in doubt, open this doc, **`docs/draft-observability.md`**, and **`lib/draft/legacy-runtime-write-guard.ts`**.

## Suggested Phase 5H

1. **Log drain dashboard** — charts from `draft_health` JSON lines (volume by `event`, error rate, cron duration).
2. **Integration tests** — seeded league for cron + snapshot parity (non-mock Prisma).
3. **Realtime** — only if product requires cross-instance draft streaming beyond polling.

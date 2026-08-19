# AF Live-Data Scheduled Refresh — Build Brief

**Status:** ready to build — but **verify-first** (the audit is stale) · **Prepared:** Jul 15, 2026
**For:** Claude Code in `F:\allfantasy-v2-main` · **Goal:** make sure the live data the control room shows actually **refreshes on a schedule** — so "live" is actually true, not just true-at-import. Close the *real* gaps, not the ones a stale audit named.

**Read alongside:** `AF_CONTROL_ROOM_BUILD.md` §3, `AF_DATA_PROVENANCE_AUDIT.md` (⚠ its cron section is **stale** — see §1), the per-feed health work already shipped (`/api/health/data-providers`, commit `bf5ec01d5`).

---

## 0. ⚠ Verify before you build (the #1 rule this session taught us)
The provenance audit's "**22 cron paths in `vercel.json` have no route handler**" is **out of date** — `vercel.json` has since been cleaned up. Confirmed from the current file: all 18 `/api/cron/*` entries have matching handlers, and the audit's named-missing paths (`import-projections`, `import-rankings`, `health-check`, `data-freshness`, `sync-playoff-brackets`) are **not in `vercel.json` at all**. So: **do not "add the 22 missing routes."** First reconcile reality, then fix only genuine gaps. Trust live code over the audit's line refs.

---

## 1. Step 1 — reconcile `vercel.json` ↔ handlers (audit script)
Write/run a tiny check that, for every `crons[].path` in `vercel.json`, strips the query string and asserts a matching `app/**/route.ts` exists. Report any path with no handler (those would 404 when Vercel invokes them). Confirmed-present already: all `/api/cron/*`. **Unverified from here (you must check):** the non-`/api/cron` cron paths — `/api/discord/poll-messages`, `/api/redraft/*`, `/api/keeper/*`, `/api/bestball/*`, `/api/guillotine/*`, `/api/survivor/*`, `/api/tournament/automation`, `/api/zombie/automation`, `/api/big-brother/cron/*`, `/api/devy/automation`, `/api/idp/cap/expire-contracts`, `/api/c2c/automation`, `/api/weather/refresh-cron`, `/api/brackets/**`. For each missing handler: build it or remove the cron entry — **match `vercel.json` to reality**, either direction, no dangling entries.

Keep this script (e.g. `scripts/verify-crons.ts`) so this can't silently regress.

---

## 2. Step 2 — the genuine gap: projections & rankings have no scheduled ingest
The audit's deeper point survives even though its framing is stale: **there is no `import-projections` or `import-rankings` cron in `vercel.json`.** So projection and ranking data only flows in **on-demand** through `lib/workers/api-chain.ts` when something requests it — it never refreshes on a schedule. That directly undercuts the per-feed health chip (Projections would read stale/idle) and the "kept live" promise.

**Do:**
- Confirm the on-demand-only status (grep for any existing projections/rankings ingest path first — don't assume).
- If confirmed, add scheduled crons — **mirror the proven `import-scores` / `import-injuries` handlers** in `app/api/cron/`: an `import-projections` (and, if rankings ingest is real, `import-rankings`) route that writes the normalized `FantasyProjection` (and rankings) tables via the same `fetchWithChain` providers, gated by the existing `_auth.ts` cron-auth.
- Add the new path(s) to `vercel.json` on a sensible cadence (projections refresh weekly in-season / less in offseason — match the data's real update rhythm; don't over-poll).
- **Offseason honesty:** if projections/rankings legitimately don't update in the NFL offseason (now — July), the cron should no-op cleanly and the health chip's honest `null`/"idle" is correct, not an error.

---

## 3. Step 3 — duplicate & suspicious entries
- `/api/zombie/automation` is listed **twice** with different schedules (`0 * * * *` hourly and `0 9 * * 2` weekly). Confirm whether that's intentional (two jobs, one path, distinguished internally) or a copy-paste bug — fix or document.
- Scan for any other duplicate `path` values.

---

## 4. Step 4 (optional, nice-to-have) — a freshness monitor cron
The per-feed health route currently computes freshness **per-request** from each normalized table's `fetchedAt`. There are **purpose-built but unused** tables — `SportsProviderHealth` (indexed `lastSuccessAt`, `status`, `configured`, `freshnessStatus`) and `SportsDataSyncLog`. A lightweight `data-freshness` cron could populate `SportsProviderHealth` after each ingest so the health chip reads one small indexed table instead of scanning large feed tables. **Only if** the per-request queries prove slow — measure first; don't build speculative infra. If built, the health route reads `SportsProviderHealth` with a fallback to the live per-table query.

---

## 5. Build checklist (all seven)
1. **Visual** — none directly; the health chip already reflects freshness (it'll simply show fresher Projections once scheduled).
2. **Backend** — new ingest cron(s) mirroring existing ones; the verify-crons script; optional freshness monitor.
3. **UI/UX** — n/a beyond the chip staying honest.
4. **Delete old** — remove any dangling `vercel.json` entries with no handler (step 1); don't leave 404-ing crons.
5. **Fixes/gaps** — the projections/rankings schedule gap; the duplicate zombie entry.
6. **SEO/ASO** — n/a (internal).
7. **On-brand** — n/a (internal infra); keep the honest-freshness discipline (no faked "fresh").

## 6. Acceptance criteria
- [ ] `scripts/verify-crons.ts` passes: **every** `vercel.json` cron path resolves to a real handler (no 404s), and it's wired to run in CI or a test.
- [ ] Projections (and rankings, if real) refresh on a scheduled cron writing the normalized tables — verified by a fresher `fetchedAt` after a manual invoke.
- [ ] The per-feed health chip shows Projections with a real recent timestamp in-season (honest idle/null in offseason).
- [ ] The duplicate `/api/zombie/automation` entry is resolved or documented.
- [ ] No speculative freshness infra unless a measured need (step 4 is optional).

## 7. Verification
- `npm run build` + `npm run typecheck` clean (ts:ratchet — no new errors).
- Run `verify-crons.ts` → zero unresolved paths.
- Manually invoke the new projections cron (with cron auth) → confirm `FantasyProjection.fetchedAt` advances and the health route reports it.
- Tests: verify-crons finds a deliberately-broken entry; the new ingest handler writes rows + is auth-gated.

## 8. Sequencing
1. Reconcile `vercel.json` ↔ handlers (script + fix dangling entries).
2. Close the projections/rankings scheduled-ingest gap (the real one).
3. Fix the duplicate zombie entry.
4. Freshness monitor — only if measured need.

*The lesson from last session, applied: the audit named a problem that's largely already fixed. Verify the real state first, then the actual gap here is narrow — scheduled projections/rankings ingest — not "22 missing routes."*

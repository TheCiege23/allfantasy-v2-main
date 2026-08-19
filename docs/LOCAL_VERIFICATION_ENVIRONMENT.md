# Local Verification Environment — Setup, Reset, and Findings

**Status:** Phase 1 complete (auth recovered, environment proven in-browser) · **Prepared:** 2026-07-17
· **Branch:** `claude/verification-loop-recovery`

The purpose of this document is that a developer can go from a fresh checkout to *seeing the real
AllFantasy dashboard render with real league data in a browser*, which was not possible before this
pass.

---

## 1. TL;DR — exact commands

```sh
# 1. Confirm you are NOT pointed at production (see §3 — do this every time)
node -e "console.log(new URL(process.env.DATABASE_URL.replace(/^postgres(ql)?:\/\//,'http://')).host)" \
  --env-file=.env
# EXPECTED: ep-curly-block-...  (shadow/dev)
# ABORT IF:  ep-spring-tooth-... (PRODUCTION)

# 2. Bring the DB schema up to date (both steps are required — see §4)
npx prisma migrate deploy
npx prisma db push --skip-generate      # closes schema-ahead-of-migrations drift

# 3. Seed the dev fixture — gives Local Dev User BOTH dashboard contexts
npm run seed:dev
#    -> "Dev Commissioner League" (dev user OWNS it)  -> Commissioner Focus
#    -> "Dev Managed League"      (dev user is MEMBER) -> Team Focus
#    Idempotent: re-run any time. Reset just this fixture: npm run seed:dev -- --reset

# 4. Run
npx next dev -p 3000        # use 3000 — NEXTAUTH_URL is pinned to it (see §6)

# 5. Log in — open http://localhost:3000/login and click "Continue as Local Dev User"
```

`npm run seed:dev` (`scripts/seed-dev-fixture.ts`) **fails closed**: it refuses the production host
marker, refuses any host not on an explicit dev allowlist, and refuses an absent/unparseable
`DATABASE_URL`. All three refusal paths were tested by simulating each URL. Its teardown is scoped
strictly to its own two league ids — never a global delete.

### Seeded test accounts (created by `seed-redraft-war-room-runtime.ts`)

| Login | Password | Role |
|---|---|---|
| `rwr_runtime_commish` | `Password123!` | Commissioner of the seeded league |
| `rwr_runtime_member` | `Password123!` | Member (non-commissioner) |
| `rwr_runtime_outsider` | `Password123!` | No league membership |
| *Local Dev User* (button) | n/a | `DEV_AUTH_BYPASS` — **owns no leagues** (see §7) |

---

## 2. Environment & branch inventory

- **Worktree:** `C:/tmp/af-decision-os-activation` (isolated; the shared primary checkout at
  `F:/allfantasy-v2-main` has had two concurrent-session collisions this session — see
  [[concurrent-session-shared-git-index]]).
- **Surfaces present on `main`:** `/dashboard`, `/commissioner-hub`, `/manager-hub`, `/af-legacy`,
  `/fantasy-os`, `/fantasy-os/executive`, `/war-room`, `/ai`, `/ai-chat`.
- **Surfaces ABSENT on `main`:** `/v2`, `/v3`.
- **`docs/design/V1_*.md`: does not exist on `main` and was not found on any scanned remote branch.**
  The design-system memory describing 7 V1 specs + `/v2` + `/v3` shells appears to describe work that
  was never merged (or never existed at these paths). **This is a stop-gate item: the intended design
  specifications could not be located.** What *does* exist is design *infrastructure*: 492 CSS custom
  properties in `app/globals.css`, `components/ui/` primitives, a theme/mode system, i18n × 5 locales.

## 3. Database identity — the safety check

**Both `.env` and `.env.local` point at `ep-curly-block-ad0dlt9o-pooler.../mydb_shadow`.** Production
(`ep-spring-tooth`) appears **only** in `.env.prod-deploy`.

> **This corrects a stale memory** ([[redraft-verification-and-local-prod-db]] /
> [[prisma-cli-env-override-danger]]) which asserted `.env` = production. That was true on 2026-07-14;
> it is not true now. Because the Prisma CLI reads `.env`, this change is what makes `prisma migrate`
> safe to run locally at all. **Re-verify with the §1 step-1 command before every schema command** —
> this fact has already changed once.

Verified by content, not by name: at the time of this pass the shadow DB held 2 users, **0 leagues, 0
rosters, 0 players, 0 user profiles**. It also contains one real account (`theciege22`) — do not purge
it blindly.

## 4. Root causes of the authentication failure (three, all real defects)

The `DEV_AUTH_BYPASS` 401 that blocked in-browser verification all session was **three stacked
causes**, not one:

1. **The shadow DB was 119 of 120 migrations behind** — a near-empty skeleton. `time_mismatch_flag`
   (`prisma/migrations/20260418210000_user_profile_time_engine`) did not exist, so
   `prisma.userProfile.upsert()` threw and `authorize()` 401'd.
   *Fixed by:* `npx prisma migrate deploy`.
   *One migration conflicted* — `20260509061103_live_draft_autopick_preferences` failed with
   `42P07 relation already exists` (created historically outside migration history). Before resolving
   it, the live table was compared against the migration's intent: **all columns and types matched
   exactly**, so `prisma migrate resolve --applied` was accurate rather than papering over drift.

2. **The Prisma schema has drifted AHEAD of the migration history.** `chimmyTtsVoiceId`
   (`prisma/schema.prisma:5087`, `@map("chimmy_tts_voice_id")`) is required by the client but **no
   migration in `prisma/migrations/` creates it**. Any database built purely from migration history is
   missing columns the app requires.
   *Worked around by:* `npx prisma db push`.
   **This is a real, unfixed defect — see §8.**

3. **The `dev-bypass` provider never returned `username`.** `lib/auth.ts`'s JWT callback stamps
   `token.username` by reading `user.username` off the `authorize()` return. The `credentials`
   provider returns it; **`dev-bypass` omitted it**. The consequence is documented in the file's own
   comment at line ~543 (*"without this, token.username is always null"*): the username gate in
   `middleware.ts` then redirected **every** dev-bypass session to `/choose-username`, so the bypass
   could never reach any gated page — including the dashboard it exists to reach.
   *Fixed in this branch:* one line, `username: user.username`, mirroring the `credentials` provider.
   **This is a genuine bug fix, not a safety bypass** — the dev user is a real `AppUser` row with a real
   username already in the database.

## 5. Runtime verification evidence (in a real browser)

Verified against `http://localhost:3011`, Chrome, authenticated session:

| Check | Result |
|---|---|
| Login succeeds | ✅ `signin: 200`; session `{"username":"local_dev_user","id":"local-dev-user"}` |
| Seeded user reaches the dashboard | ✅ `/dashboard` → `200` (was `307 → /choose-username`) |
| Global Command Center renders | ✅ "GLOBAL COMMAND CENTER / This is Fantasy HQ.", All-Leagues pill, breadcrumb |
| Renders with **real seeded data** | ✅ leagues counter `0 → 1`; "MY LEAGUES" shows *Runtime Seed NFL Redraft War Room*, `2-1`, `In Season`, health badge `EXCELLENT` |
| Commissioner context resolves | ✅ COMMISSIONER HUB panel appears for the commissioner-owned league; nav swaps "Run a League" → "Commissioner Hub" |
| **No fabrication when data is absent** | ✅ Signed in with zero leagues: `0/0/0/0` counters, AF Rank/Tier/XP all `—`, "You're all caught up", "Next Opponent: Not available right now". Nothing invented. |

### After `npm run seed:dev` — all three contexts observed as Local Dev User (one-click bypass)

| Context | Evidence |
|---|---|
| **Global Command Center** | "GLOBAL COMMAND CENTER / This is Fantasy HQ.", leagues counter `2`, MY LEAGUES lists both fixture leagues |
| **Commissioner Focus** | *Dev Commissioner League* renders with a 👑 marker; the COMMISSIONER HUB panel lists **only** that league — the member league is correctly excluded |
| **Team Focus** | Selecting *Dev Managed League* flips the whole shell to "TEAM HEADQUARTERS / Focus. Compete. Win Championships.", breadcrumb `TEAM HEADQUARTERS · Dev Managed League`, and swaps in THIS WEEK'S MATCHUP, SEASON JOURNEY (`SETUP → PRE-DRAFT → DRAFTING → POST-DRAFT → IN SEASON`), INJURY IMPACT, RECOMMENDATIONS |
| **League switching** | ✅ Switcher populated with `All Leagues / Dev Commissioner League / Dev Managed League`; selecting one re-renders the context |

The crown-vs-no-crown split and the Commissioner Hub filter are the live proof that
`resolveIsCommissioner()` classifies the two fixture leagues correctly (owner + `allfantasy` platform
⇒ commissioner; synthetic owner + `MEMBER` role ⇒ not).

## 6. Defect & error log (found during this pass, NOT fixed)

| # | Severity | Finding |
|---|---|---|
| D1 | **High** | Prisma schema drifted ahead of migrations (`chimmy_tts_voice_id`, §4.2). A migration-only deploy produces a broken DB. Needs a real migration generated — but that affects production deploys, so it is a decision, not a drive-by fix. |
| D2 | Medium | `NEXTAUTH_URL=http://localhost:3000` in `.env.local` is **port-pinned**. Running on any other port makes NextAuth emit `callbackUrl`/`signinUrl` pointing at `:3000`, producing cross-port redirects. Use port 3000, or override `NEXTAUTH_URL`. |
| D3 | Medium | `seed-redraft-war-room-runtime.ts` has **no production guard** — no host check, no refusal. It is only safe because `.env` currently points at the shadow DB. The brief requires seeds be "clearly prevented from executing against production"; this one is not. |
| D4 | Low | The login page copy reads *"Sign in to access the Sports App, Brackets, and **AI Tools**."* — an "AI" customer-copy violation per the brand rule. |
| D5 | Low | Default theme renders **Light** (top bar shows `Theme: Light`) with a dark navy hero, i.e. a mixed light/dark presentation, while the stated direction is "premium dark". Worth confirming the intended default. |
| D6 | Low | Clicking the login page's Google button initiates a **real** Google OAuth flow against `localhost:3000` — expected, but a trap in a dev environment. |
| **D7** | **High — newly proven in-browser** | **The league selector does not scope the RECOMMENDATIONS panel.** In Team Focus for *Dev Managed League*, every Recommendations row is labelled `DEV COMMISSIONER LEAGUE` — i.e. the *other* league's items render under this league's context. The hero simultaneously reads `0 LINEUP DECISIONS` but `4 URGENT`, because the urgent count is drawn from the unscoped set. This is a **runtime-confirmed instance** of the "only 2 of 8 dashboard sections honor the selector" finding from the dashboard real-data audit — previously a code-read claim, now observed. A user in one league is shown another league's urgent actions. |
| D8 | Low | Team Focus shows "Season outlook is being calculated / Your playoff and championship projections will appear here shortly" — reads as a permanent placeholder rather than a real pending state; worth confirming it ever resolves. |
| D9 | Low | INJURY IMPACT renders the static string "No injury concerns for your starters." even with empty rosters — matches the dashboard audit's suspicion that this is unconditional rather than a real roster↔injury join. |

## 7. Seed architecture — current state and the gap

`scripts/seed-redraft-war-room-runtime.ts` (reused rather than rebuilt) is **idempotent** (fixed
deterministic IDs, upserts) and produces: 1 NFL redraft league + season, commissioner/member/outsider
users with real logins, 2 rosters, 21 roster players, synthetic provider rows.

**It does not yet satisfy the full brief.** Delta against the requirement list:

| Required | Status |
|---|---|
| One authenticated test user | ✅ (three) |
| One commissioner-owned NFL redraft league | ✅ |
| One non-commissioner league membership | ⚠️ `seed-managed-only-dev-league.ts` exists for this; not yet composed in |
| 8–12 managers | ❌ (2 rosters) |
| Full rosters | ⚠️ 21 players across 2 rosters |
| Scoring + lineup settings | ✅ (league/season created) |
| Draft history / upcoming draft | ❌ |
| ≥1 pending trade | ❌ (`seed-redraft-trade-walkthrough.ts` exists — compose in) |
| ≥1 waiver item | ❌ (`seed-redraft-waiver-walkthrough.ts` exists — compose in) |
| ≥1 incomplete lineup | ❌ |
| ≥1 inactive-manager signal | ❌ |
| History/activity for health, rankings, Legacy, notifications | ❌ (AF Rank/Tier/XP render `—`) |
| Production-guarded | ❌ (D3) |
| Documented / re-runnable | ✅ (this document) |

**Critical gap:** the seeded league belongs to `rwr-runtime-commissioner-user`, **not** to the
`local-dev-user` that the one-click bypass authenticates as. So the bypass button reaches the dashboard
but sees zero leagues; seeing data currently requires logging in as `rwr_runtime_commish`. The
composed seed should attach both a commissioner league and a non-commissioner membership to
`local-dev-user`.

## 7b. D1 deep-dive — the migration history is not the source of truth

> ### ✅ NARROW FIX SHIPPED (2026-07-17)
> `prisma/migrations/20260717070000_backfill_missing_schema_objects/migration.sql` — approved and
> applied as option (1) below. It backfills **only** the two objects confirmed missing by direct
> verification: `user_profiles.chimmy_tts_voice_id` and the `fantasy_players` table. Every statement
> is `IF NOT EXISTS`. Column types, defaults, nullability and all 6 indexes were read out of a live
> database's `information_schema`/`pg_indexes` — not inferred from the Prisma model.
>
> **Verified in both directions, empirically:**
> - **No-op on a database that already has both** (production's state): applied it to the fully-synced
>   dev DB; fingerprints identical before/after — `fantasy_players` 18 cols, `user_profiles` 74 cols,
>   6 indexes → unchanged. Nothing added, nothing dropped, no data rewritten.
> - **Creates both on a migration-built database**: dropped both objects to simulate that state
>   (verified `0 | 0`), applied the migration, got back exactly `18 | 74 | 6`.
> - **Shape is exact, not approximate**: `prisma db push` afterwards reports *"The database is already
>   in sync with the Prisma schema"* — Prisma itself sees zero drift from the recreated objects.
> - **End-to-end regression**: dev-bypass signin `200`, `/dashboard` `200`, and `/api/user/profile`
>   returns `chimmyTtsVoiceId` — i.e. this closes the exact gap that caused the morning's login bug.
>
> **Scope held deliberately narrow.** The broader "regenerate the full migration history" project
> (66 flagged models) remains separate and unscoped. Do not widen that migration file.

**Investigated on request. The headline changed: D1 is not "one column missing a migration."**

### The column itself
`prisma/schema.prisma:5087` — `chimmyTtsVoiceId String? @map("chimmy_tts_voice_id")`.
Nullable `TEXT`, no default, on `user_profiles`.

### How it got in without a migration
Commit `bbf01264f` (2026-04-06, *"feat: Chimmy voice sync, chat UX, pricing hero, dashboard
onboarding"*) edited `prisma/schema.prisma` (+3 lines) and shipped **zero migration files** — verified:
that commit touches no path under `prisma/migrations/`. So the schema was changed and the database
was reconciled out-of-band (`db push` or equivalent), never through migration history.

### Is it dead code? **No — and this is the decisive answer to the "maybe just remove it" option.**
It is a **live, reachable feature**:
- `app/api/user/profile/route.ts:101,124,199-203` — reads and writes it.
- `hooks/useChimmyTtsVoiceSync.ts:39` — syncs it.
- `components/settings/ChimmyVoiceSettingsCard.tsx` — a real settings card, **rendered** by
  `app/settings/components/sections/PreferencesSettingsSection.tsx:207`, i.e. reachable at `/settings`.

**So "remove the column" is the wrong fix. It backs a shipped feature.**

> **Master-plan item #44 ("Voice interaction — UNKNOWN, NEEDS AUDIT") — partial answer:** a Chimmy
> **TTS voice-selection** feature exists and is live in Settings (user picks Chimmy's voice; persisted
> on `user_profiles.chimmy_tts_voice_id`). That is *not* the full "spoken Q&A / read-aloud briefs /
> draft-room voice assistance" the blueprint describes — only voice **output preference**. Item #44
> should read "partial: TTS voice selection shipped; conversational voice I/O still unaudited."

### What actually breaks today — worse than "only a fresh DB"
This is precisely what blocked login all session. `ensureDevAuthUser()` → `ensureSharedAccountProfile()`
→ `prisma.userProfile.upsert()` selects every mapped column, including `chimmy_tts_voice_id`. On a
database built from migration history the column is absent, Prisma throws, `authorize()` throws, and
NextAuth returns **401**. So the blast radius is *"authentication is broken on any migration-built
database"*, not merely "a fresh DB lacks a column."

### Scope — the part that changes the recommendation
`chimmy_tts_voice_id` is **not** an isolated slip:
- Precise check of `user_profiles`: **21 of 22** mapped columns are covered by migration history;
  exactly **1** (`chimmy_tts_voice_id`) is not. Narrow *for this table*.
- Repo-wide, the picture is systemic. A scan of every model's mapped names against the full migration
  corpus flags **66 models**. Spot-verified concretely: **the `fantasy_players` table appears in no
  migration file at all**, yet exists in the live database — i.e. `db push` created it. Whole tables,
  not just columns, have no migration backing.
- *Caveat on the number:* the scan's regex also catches `@@map` table names alongside `@map` column
  names, so the raw count (288) mixes both and should be treated as an indicator of shape, not a
  precise column tally. The `user_profiles` figure (1 of 22) and the `fantasy_players` spot-check were
  both verified individually and are exact.

**Conclusion: `prisma migrate deploy` alone cannot build a working AllFantasy database.** The
migration history is materially incomplete; the real schema is whatever `db push` last reconciled.
Production presumably works because it was `db push`-ed at some point — meaning production's schema is
not reproducible from source control.

### Proposed minimal fix (NOT applied — needs an explicit decision)
Two genuinely different options, and the choice is a policy call, not a code call:

1. **Narrow / unblock-only.** Add one migration for the auth-critical column:
   `ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "chimmy_tts_voice_id" TEXT;`
   `IF NOT EXISTS` is essential — it makes the migration a **no-op on production** (where the column
   already exists via `db push`) while repairing any migration-built database. Low risk, ~5 minutes,
   fixes login-on-fresh-DB. **Does not** fix the other 65 models.
2. **Reconcile properly.** Generate a baseline/squash migration from the current schema
   (`prisma migrate diff --from-migrations --to-schema-datamodel`, applied against a scratch shadow
   DB) so migration history once again reproduces the real schema. Larger, needs a clean shadow
   database, and must be verified not to attempt destructive changes against production — but it is
   the only option that makes the schema reproducible from source control.

**Recommendation:** do (1) now to unblock any fresh environment, and treat (2) as its own scoped piece
of work. Do **not** do (2) as a drive-by — it rewrites how this project deploys schema.

## 8. Recommended next steps (no destructive action taken)

1. **Compose one `seed:dev` entrypoint** from the existing pieces (`redraft-war-room-runtime` +
   `managed-only-dev-league` + `trade-walkthrough` + `waiver-walkthrough`), attach them to
   `local-dev-user`, add a production host guard, and register it in `package.json`.
2. **Decide on D1** — generating the missing `chimmy_tts_voice_id` migration touches production deploy
   behavior and needs an explicit call.
3. **Do not** retire `/war-room`, `/fantasy-os`, `/v2`, `/v3`, or any surface on the strength of this
   pass. `/v2` and `/v3` are absent from `main` and from every scanned remote branch, but "absent" is
   not "obsolete" — the intended design specs could not be located and that gate is unresolved.

## 9. Explicitly not done

Phase 3 convergence (`/api/ai/manager-dna`) not started — the environment work consumed this pass.
Team Focus and league-switching screenshots not captured (the seeded league is commissioner-owned; a
non-commissioner membership for the same user is the missing seed piece). Light/dark/AF mode matrix,
locale matrix, and mobile-layout checks not performed. No production data touched; no route retired.

# AF Gate 0 — Pre-Auth Trial Build Brief

**Status:** ready to build · **Prepared:** Jul 15, 2026
**For:** Claude Code, running in `F:\allfantasy-v2-main`
**Goal:** Move the golden-path "wow" in front of the signup wall. A logged-out visitor types their Sleeper username, sees their real leagues light up on the command center in seconds, and is shown — but gated from — the deeper paid tools. Signing up preserves everything they imported.

**Read alongside:**
- `AF_B2C_USER_READINESS_PLAN.md` — the golden path (§4) and gates.
- `AF_GOLDEN_PATH_DEMO_SCRIPT.md` — the exact flow this must deliver.
- `AF_POSITIONING_AND_LANDING_COPY.md` — voice rules (never "AI"; see-and-decide scope).
- The free-vs-paid tier matrix (v1, locked Jul 15) — what's free vs gated.

---

## 1. Scope of THIS brief

**In scope:** the pre-auth trial funnel end to end —
1. Public landing input → Sleeper import with no login.
2. Anonymous trial session that holds the imported data.
3. The command center rendering in limited/free mode.
4. Free-tier gating of the deep tools (locked previews + upgrade prompts).
5. Account creation that **migrates** the anonymous trial into the new user.

**Out of scope (separate follow-on briefs):** Stripe checkout / billing, the full per-tier entitlement engine for Pro/Commissioner/Supreme/War Room, token purchase + spend ledger, and the League Tycoon import adapter (new provider — see §7). This brief must leave clean seams for all of them.

---

## 2. The flow to build

1. **Landing (`/`)** — a primary "See all your leagues in one place — start free" input. User enters a **Sleeper username**. One field, one button. (Voice: no "AI"; lead with the payoff.)
2. **Import (no auth)** — resolve username → Sleeper `user_id` → leagues → rosters + history. Show honest, fast progress. Target: populated board in **< ~90s** (Gate C).
3. **Board lights up (`/dashboard/universal` in trial mode)** — all imported leagues appear at once. *This is the money moment.* Real names, records, rosters.
4. **"What needs your attention" (basic)** — Priority-by-Platform in its free/basic form across the imported leagues.
5. **Show the breadth, sell the aggregation** — prominent "Add your other platforms" surface listing **ESPN · Yahoo · Fantrax · MFL · League Tycoon** (free to connect). ESPN/Yahoo run OAuth — that flow is the natural account-creation moment.
6. **Gated depth** — deep tools (Trade Finder, Waiver Assistant, Lineup Optimizer, Draft Assistant, projections) render as **locked previews** with a clear upgrade path (subscribe or spend a token). Never a dead end; always show what they'd get.
7. **Sign up** — when the user creates an account (email + username, or completes ESPN/Yahoo OAuth), **migrate the anonymous trial session into the new user** so nothing they imported is lost.

---

## 3. Technical requirements

### 3.1 Public Sleeper import endpoint
- Reuse the existing Sleeper import path in `lib/league-import/` (fetch/normalize/preview) rather than a parallel implementation; expose a **no-auth** entry that stops at a trial-scoped result (do NOT commit into a real user's account).
- **Rate-limit** per IP + username and **cache** results (Sleeper data is public and stable within a window) to protect the endpoint from scraping/abuse.
- Graceful failures: unknown username, no leagues, Sleeper timeout — each returns a clear state, never a spinner-of-death.

### 3.2 Anonymous trial session
- Issue a signed, http-only **trial session token** (cookie) carrying a `trialId`. No PII.
- Persist the imported trial payload server-side keyed by `trialId` (short TTL, e.g. 7–30 days), OR in a `GuestSession`/`TrialSession` record. Do not rely on browser storage.
- The dashboard reads trial data from this session when there's no authenticated user.

### 3.3 Limited/free dashboard mode
- The command center must render for an unauthenticated trial session, showing only what the tier matrix marks **Free**: all leagues on the board, unified view, and **basic** attention / player search / legacy.
- Everything marked paid renders as a **locked preview** component (blurred/teaser + upgrade CTA), driven by a single `entitlement` check so the follow-on tier engine can slot in without re-plumbing.

### 3.4 Entitlement seam (stub now, engine later)
- Add one gate function, e.g. `canAccess(feature, context)`, returning `free` for trial/free users and a locked result for paid features. Centralize it — every gated surface calls this, nothing checks tiers inline.
- Model the plan/entitlement + token-balance fields on the user now (even if billing isn't wired), so migration and later Stripe work attach cleanly.

### 3.5 Signup migration (non-negotiable)
- On account creation (or first authenticated load after a trial), **claim** the `trialId` payload → attach imported leagues/history to the new `userId`, then invalidate the trial token.
- **Idempotent**: replaying migration must not duplicate leagues. Handle the ESPN/Yahoo-OAuth-first path (account exists before the "sign up" click) the same way.
- Acceptance-critical: import → love it → sign up → **data still there**.

### 3.6 Connect other platforms (free)
- Surface ESPN, Yahoo, Fantrax, MFL, League Tycoon as free connections. ESPN/Yahoo OAuth doubles as the account moment. League Tycoon adapter is out of scope here — show it as "coming" if the adapter isn't built yet (see §7), don't fake an import.

---

## 4. Copy & compliance (must-follow)
- **Never the word "AI"** on any customer-facing surface (P1). Use Assistant / Coach (Chimmy) / Insights / Intelligence-as-a-feeling.
- **Scope honesty:** "see and decide," never "manage your ESPN/Yahoo team from here." AF advises; the action happens on the source platform.
- **Real numbers or nothing:** trial surfaces show only real or honestly-empty data — no fabricated projections in the free view.

---

## 5. Acceptance criteria
- [ ] Logged-out visitor imports a **real** Sleeper league by username with no account, board populated in **< ~90s**.
- [ ] The trial dashboard shows all leagues + basic attention/search/legacy; every paid tool shows a locked preview with an upgrade path (no dead ends, no fabricated numbers).
- [ ] "Add your other platforms" lists ESPN · Yahoo · Fantrax · MFL · League Tycoon; ESPN/Yahoo OAuth works and creates/links an account.
- [ ] Creating an account **preserves 100%** of the imported trial data; migration is idempotent (no duplicate leagues on replay).
- [ ] Public endpoint is rate-limited + cached; abusive/invalid input fails gracefully.
- [ ] No "AI" string on any user-facing surface in this flow; scope copy is accurate.

---

## 6. Verification
- `npm run build` + `npm run typecheck` clean.
- Unit/integration tests for: username→leagues resolve, trial-session create/read, entitlement gate returns locked for paid features, and **migration idempotency** (run twice → one set of leagues).
- Manual golden-path pass from a logged-out incognito window on a real Sleeper account; capture the screenshot reel (doubles as Gate A evidence).

---

## 7. Open follow-ups (not blockers for this brief)
- **League Tycoon import adapter** — new provider; not in the certified-5 (`lib/league-import/`). Needs its own fetch/normalize/commit service + real-account certification. Track as its own brief.
- **Tier entitlement engine + Stripe billing + token ledger** — the `canAccess()` stub and plan/token fields here are the seam; the real engine is the next brief.
- **Pricing** for Pro / Commissioner / Supreme / War Room + token pack sizes — still to be set.

---

*Sequence: implement this → build → push to prod → certify the golden path (Gate A) from a fresh trial. Then the tier-engine + billing brief.*

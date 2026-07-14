# AllFantasy — Phase 2 handoff + Phase 0 follow-ups (run in Claude Code, on the repo)

Run in Claude Code with git access. Work on a branch (continue `feat/af-phase0-foundation` or
branch from it). Only ever `git add <specific files>` — the tree has ~700 unrelated uncommitted
paths. Verify (`npm run typecheck` + relevant tests + `npm run build`) and commit each set.

Design mockups referenced below are now in the repo at **`_design-mocks/`**
(`universal-dashboard.html`, `full-flow.html`, `landing.html`). Open them in a browser to see the
visual target; their CSS `:root` / `[data-theme]` blocks are the token spec.

---

## Follow-up B — FranchiseSeason historical backfill

The Phase 0 fix made `franchise_seasons` populate at season-finalize *going forward*, but leagues
that already completed a season have no row, so their history doesn't count toward rank yet.

1. **Refactor** the `FranchiseSeason.upsert` you added at the season-finalize point into a small
   reusable helper, e.g. `upsertFranchiseSeasonRows(leagueId, season, records, champion, runnerUp)`
   — same inputs it already computes for `LeagueSeason`. Call it from both the finalize path and
   the backfill below (one source of truth for the mapping — never a second champion/record
   determination).
2. **New script** `scripts/backfill-franchise-seasons.ts` (tsx). For each native-platform league
   (`platform in ('allfantasy','af','manual')`) iterate its completed `LeagueSeason` rows; derive
   per-franchise rows from `LeagueSeason.teamRecords` (JSON) + `championTeamId`, mapping team →
   `userId` via `leagueTeam.claimedByUserId`. Upsert through the helper (idempotent on the unique
   `[leagueId, rosterId, season]`). Skip if a row already exists.
   - Flags: `--dry-run` (log counts only) and `--league <id>` (single league for testing).
   - Wrap each league in try/catch; log per-league results; never let one league fail the run.
3. **After backfill**, call `calculateAndSaveRank(userId)` for each affected user so ranks reflect
   the new history (batch it).
4. Confirm `LeagueSeason.teamRecords`' actual shape (the `LeagueSeasonTeamRecord` type in app code)
   before mapping — don't guess field names. Dry-run on 1–2 leagues first.

---

## Item 6 — Design tokens (reconcile, don't replace)

`app/globals.css` already has a real `html[data-mode="dark"|"light"|"legacy"]` token system
(`--bg`/`--panel`/`--text`/`--color-primary`…) and real AF shield assets in `public/brand/`. Do NOT
rip that out.

- Map the mockup token names (`--bg`,`--panel`,`--border`,`--text`,`--muted`,`--purple`,`--cyan`,
  `--blue`, AF shield) onto the existing `data-mode` tokens; add any missing **light-mode** parity
  so the mockups' light theme works.
- Use `public/brand/af-shield*.png` (or an inline SVG matching it) for the logo — the mockups draw
  the shield as SVG; swap in the real asset.
- Keep the white-label override layer intact (tenant theming still wins).
- Deliverable: the new surfaces below consume these tokens so light/dark + white-label all work.

---

## Phase 2 — Universal dashboard (real) + Legacy integration

Goal: the `_design-mocks/universal-dashboard.html` dashboard, on real data, with Legacy folded in
and a guest/preview state. Target mockup: `_design-mocks/universal-dashboard.html` (and the
dashboard stage in `full-flow.html`).

**Reuse:** `getDashboardLeagueListForUser` (already returns all platforms + native, and native now
feeds rank); the existing `app/dashboard/universal/` (`page.tsx` + `UniversalLeaguesBoard.tsx` — a
plainer first version I shipped, use as the starting point); `FeatureGate` / `useEntitlements` /
`useSubscriptionGate`; the `/af-legacy` tab logic; the i18n provider.

**Build (re-skin + extend `app/dashboard/universal/`):**
1. **Two-row header** — row 1: logo + "Intelligence" button + messages/alerts + user menu; row 2:
   sport selector + search + "Live data connected" + "Operating Systems" launcher. (Left-cluster /
   right-cluster layout; no floating gap — see the mockup.)
2. **Settings menu** (from the user chip): profile + avatar change, subscription + **token
   balance**, connections (Spotify/Discord/Sleeper…), preferences, dark-mode toggle, log out.
3. **Operating Systems launcher** — slim strip / menu linking to Decision/Draft/Trade/Waiver/
   Manager/Commissioner/League OS. Dashboard stays OS-powered underneath.
4. **Priority by Platform** row — the single most important need per connected platform (labeled),
   with a direct action each.
5. **Dynasty Planet player search** — wire to your real player search + roster/ownership data:
   headshot, team logo, season stat dropdown, and per-platform cross-league ownership %.
6. **Portfolio analytics + league cards** — league cards with platform badges (native AF leagues
   get the AF shield badge), status/next-action signal, connect-more strip.
7. **Tabbed chat** — DMs / Huddle (3+) / Chimmy, where **Chimmy is league-specific when a league is
   selected** (adjusts to that league's scoring/SF/TEP/IDP/roster/waiver/trade rules) and general +
   up-to-the-minute on the main dashboard.
8. **Fold in Legacy** — Overview/Legacy Score, Compare/rivalry, Rankings as dashboard modules
   reusing `/af-legacy` logic (not a separate 18k-line page).
9. **Guest / generous-preview state** — full dashboard visible; premium modules wrapped in
   `FeatureGate` with the blurred-panel + "Unlock with AF Pro / Commissioner / War Room" treatment
   from the mockup. Decision OS → Pro, Commissioner OS → Commissioner, War Room → War Room.
10. **Remove all "AI" wording** → Intelligence / Chimmy / OS (per the mockups).

**Verify:** `npm run typecheck` + `npm run build`; load `/dashboard/universal` and eyeball against
the mockup in both light and dark.

**Decision (ask the user):** replace the current 3-panel dashboard, or run `/dashboard/universal`
alongside it first and promote later.

---

## Commit discipline
Separate, focused commits: (1) backfill helper + script, (2) design-token reconciliation,
(3) dashboard re-skin, (4) Legacy integration, (5) gating/guest state. `git add <files>` only.

# AllFantasy — Next builds (piece 4 → Phase 1 → Phase 3)

Run in Claude Code, on a branch off `feat/af-phase2-dashboard`. Same discipline: `git add` only the
files each task touches, verify (typecheck + build + relevant tests + live check), commit each set.
Full roadmap in `AF_BUILD_PLAN.md`; deploy in `AF_DEPLOY_RUNBOOK.md`; mockups in `_design-mocks/`.

Do these in order.

---

## ① Piece 4 — Tabbed chat with league-aware Chimmy

The exact gap this session already found: `ChimmyChat.tsx`'s `sendMessage()` never forwards
`leagueId` to the API, even though `LeftChatPanel` tracks the selected league — so Chimmy's
league-grounding never activates.

- Thread `leagueId` through `ChimmyChat.sendMessage()` → the Chimmy API, so when a league is
  selected Chimmy uses that league's scoring/SF/TEP/IDP/roster/waiver/trade rules; on the main
  dashboard (no league) it stays general + up-to-the-minute.
- Add the floating tabbed chat (DMs / Huddle / Chimmy) as a `fab-wrap` component in
  `UniversalDashboardShell.tsx`, replacing the placeholder `LeftChatPanel` widget already present
  globally. Match `_design-mocks/universal-dashboard.html` / `full-flow.html`.
- Verify: select a league → Chimmy response reflects that league's rules; deselect → general.

## ② Phase 1 — Landing + no-login guest Legacy

Reference `AF_BUILD_PLAN.md` Phase 1 + `_design-mocks/landing.html` and the landing stage of
`full-flow.html`.

- **Landing page** (marketing route / `app/page.tsx`): the direct hero, 7-platform picker with the
  per-platform step-by-step import panels, B2B "Schedule a demo" band, and working theme + language
  dropdowns — wired to the **reconciled `data-mode` tokens** (Phase 2/item 6) and your **Google
  Translate** i18n with persistence (cookie for guests, `UserProfile` for accounts).
- **Guest import path:** today `/api/legacy/import` requires `requireVerifiedUser()`. Add a guest
  variant — a signed guest-session cookie, run the Sleeper import into a guest-scoped record (Sleeper
  data is public), expose `/api/legacy/profile` for the guest. **Add abuse protection** (rate-limit
  per IP/session, cache by username+season, light bot check) — it's a public endpoint hitting Sleeper.
- Route the guest → `/dashboard/universal` in its **guest/generous-preview state** (already built in
  Phase 2 — premium panels FeatureGate-locked). Confirm the guest sees their imported profile +
  locked upgrade CTAs.
- The per-platform steps are UX for now; only Sleeper imports for real (Phase 4 wires the rest).

## ③ Phase 3 — Monetization behind the gates

The FeatureGate *UI* is already live (Phase 2). This phase builds the billing behind it. Reference
`AF_BUILD_PLAN.md` Phase 3 + the paywall stage of `_design-mocks/full-flow.html`.

- **Tier → entitlement matrix:** define exactly what AF Free / Pro / Commissioner / War Room /
  Supreme + Tokens each unlock, and map to the entitlement keys the wired FeatureGates already check.
- **Stripe products/prices** (monthly + annual per tier); wire webhooks → entitlements. Reuse the
  existing Stripe + `/pricing` `/upgrade` `/subscription` `/wallet` `/tokens` infrastructure.
- **Paywall / pricing page** from the mockup.
- **Guest → account claim:** on signup, associate the Phase 1 guest import/session with the new
  `AppUser` (link `LegacyUser`, migrate guest-scoped data) so "sign up to save" actually persists what
  they imported. (Depends on Phase 1 — that's why Phase 3 is last.)
- **Tokens:** purchase + spend hooks on heavy intelligence actions (the token/share-reward primitive
  already exists).

Decisions for the user: final pricing, and the exact free-vs-paid split per tier.

---

## Then deploy
Once these land and are green, ship them staging → prod via `AF_DEPLOY_RUNBOOK.md` (same migration-
first discipline; Phase 3 may add its own Stripe/env config to verify in each environment).

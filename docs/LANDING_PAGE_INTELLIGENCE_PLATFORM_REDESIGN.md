# Landing Page Redesign — AllFantasy Intelligence Platform

Status: **COMPLETE — 2026-07-02**. Full visual and copy redesign of the
public marketing homepage (`app/page.tsx` → `components/landing/
LandingPageClient.tsx`), repositioning AllFantasy from "AI-powered fantasy
sports app" to **"The Intelligence Platform for Fantasy Sports"**. Auth,
routing, analytics, and the language/theme systems are reused unchanged —
this is a presentation-layer rewrite, not an infrastructure change.

## Positioning strategy

Public-facing copy is intentionally **non-AI-forward**. "AI" does not
appear in the hero, nav, product cards, page `<title>`, meta description,
OG/Twitter tags, or JSON-LD schemas. Vocabulary instead leans on
Intelligence, Insights, Decisions, League Health, Retention, Engagement,
Automation, Real data, and Better outcomes — matching the ticket's
preferred-vocabulary list.

The page represents four real product lines plus one future vertical,
mapped directly to the commercial platform vision already tracked in
project memory (Decision OS → Behavioral Events → Manager/League/Platform
Intelligence → Hosted API → Widget Platform → Enterprise Licensing):

1. **Fantasy Sports App** (blue) — the core consumer product.
2. **League Intelligence OS** (green) — commissioner/operator tooling.
3. **User Intelligence** (purple) — manager behavior/engagement insights.
4. **Platform Intelligence** (orange) — API/SDK/white-label licensing.
5. **Future Intelligence Verticals** (DFS/pick'em/sportsbook-adjacent) —
   deliberately kept out of the hero and out of consumer framing. It's a
   single small partner/compliance-facing note lower on the page, worded
   as future/licensing scope only — no odds language, no betting framing,
   no promotion to users.

## Final page structure

Top to bottom: fixed header (logo, center nav, language + theme + auth
CTAs) → hero (headline, subtitle, dual CTA, trust badges, League Pulse
preview widget) → four product cards → Future Intelligence Verticals note
→ Trusted/Supported strip (platforms + formats) → Outcomes (4 metric
cards) → Licensing (3 cards + CTA) → mobile sticky CTA bar → footer (trust
bar, logo, legal links, language/theme controls, geo compliance note).

Section anchors (`#products`, `#outcomes`, `#licensing`, `#footer`) back
the center nav — see "Nav routing decisions" below.

## Copy decisions

- Hero headline/subtitle, all four product cards, the DFS note, the
  trusted strip, the outcomes cards, and the licensing section all use
  the exact copy blocks specified in the ticket, verbatim for English.
- The hero headline is split into `headlinePrefix` / `headlineGradient` /
  `headlineSuffix` per locale (rather than one hardcoded English string)
  so the gradient-highlighted "Intelligence Platform" treatment survives
  translation instead of freezing in English — this was caught and fixed
  during browser verification (see "Bugs found and fixed" below).
- Trust badges, footer trust bar, and CTA labels match the ticket's
  specified text exactly (Fantasy Sports Only / No Gambling / Secure &
  Private / Commissioner First / Free for Players; Fantasy Sports Only /
  No Betting / Built by Commissioners / Your Data Is Yours / Free to Get
  Started).
- The pre-existing World Cup Pools promotional CTA that lived in the old
  hero was **removed from the hero** to keep the two-CTA layout the
  ticket specifies (Get Started Free / Watch Overview). The route itself
  (`/world-cup-intro`) was not touched or deleted — this is a hero-content
  decision, not a feature removal.
- "Watch Overview" has no dedicated video/overview asset in this
  codebase, so it's wired as a smooth-scroll anchor to `#products` — a
  functional, honest fallback rather than a dead link or invented video
  infrastructure.

## Nav routing decisions

Confirmed via direct route checks before wiring links:

| Nav item  | Destination | Why |
|---|---|---|
| Products  | `#products` (anchor) | No dedicated marketing sub-page exists; the section lives on this page. |
| Solutions | `#outcomes` (anchor) | Closest existing section to a "solutions" framing. |
| Resources | `#licensing` (anchor) | Closest existing section (SDK/API/dashboards read as resources). |
| Pricing   | `/pricing` (real route) | Confirmed to exist. |
| Company   | `#footer` (anchor) | `/about` and `/company` do **not** exist as routes; the footer carries the company/legal info that would live on such a page. |

**Partner With Us** (Platform Intelligence card) and **Talk to
Partnerships** (Licensing section) both resolve to
`mailto:support@allfantasy.ai` with a distinguishing `subject=` param
(`Partnerships%20Inquiry` / `Licensing%20Inquiry`), not to `/partnerships`.
A dedicated research pass confirmed no `/partnerships`, `/licensing`,
`/contact`, `/enterprise`, or `/sales` route exists anywhere in `app/`,
and that `support@allfantasy.ai` is the one real, monitored inbox already
used elsewhere in the product (geo-blocked, disclaimer, privacy,
paid-restricted pages). Linking to a non-existent route would have shipped
two silent 404s; this was caught before commit, not after.

That same research pass surfaced a **pre-existing, unrelated** issue:
`components/landing/SeoLandingFooter.tsx` (a different footer component)
links to `/contact`, `/mission`, `/no-gambling-policy`, and
`/ai-transparency`, none of which exist. Out of scope for this ticket —
flagged separately rather than silently fixed or silently ignored.

## Theme (dark/light) behavior

`ThemeModeSelect` (existing component, already proven on
`DashboardShell`) is now wired into the landing page header (desktop,
`md:` and up) and footer (mobile, below `md:`) — it was not present on
this page before this redesign. It reads/writes the same `data-mode`
attribute and `THEME_STORAGE_KEY` localStorage key as the rest of the
app; no new theme mechanism was introduced. All new sections use the
existing G22 design-token CSS custom properties (`--bg`, `--text`,
`--muted`, `--panel`, `--panel2`, `--border`, `--color-primary`,
`--accent-emerald`, `--accent-purple`, `--accent-amber`, and their
`-strong`/`-soft` variants) so dark and light mode both render correctly
with zero page-specific theme logic. Verified live in the browser in both
modes at desktop and mobile widths.

One pre-existing behavior carries over unchanged: `GlobalModeToggle`, a
root-layout floating theme button rendered on nearly every route
(including `/dashboard`, which also has its own header `ThemeModeSelect`),
now also appears alongside the landing page's new header toggle. This is
not a new inconsistency introduced by this redesign — it's the same
redundant-control pattern the dashboard already ships with — but it's
worth knowing about rather than assuming the landing page has a control
duplication bug unique to it.

## Language behavior

Copy lives in a self-contained `LANDING_COPY` object keyed by locale
(`en`/`es`/`zh`), the same pattern this file used pre-redesign — per an
explicit choice made with the user in this session (static pre-translated
copy over wiring the app's real Google Cloud Translation API integration
into this specific file). `resolveCopy()` falls back to `en` for any
language code not present in the object.

**Locale coverage matches this file's own established set, not the
ticket's literal ask.** The ticket asked for English/Spanish/French/
German/Chinese. The app's actual `LanguageCode` type supports
`en/es/zh/fil/vi/fr/ar` — **German does not exist anywhere in this
codebase's language system**, app-wide, not just on this page. This
redesign ships full real translations for **en/es/zh** (the three the app
treats as production/beta-tier). `fil` and `vi` intentionally fall back to
English, consistent with how the global `t()` dictionary already labels
those two "Beta" elsewhere. `fr` was not added (the app-wide system marks
it "Coming Soon" and this page's copy set never had it). German was not
added — it isn't a supported locale anywhere in the product today, and
inventing one just for this page would create a translation island the
rest of the app can't back up.

Verified live: language selector switches en→es→zh with full copy
translation including the hero headline (see bug below), falls back to
English cleanly for an unsupported code (`fil`), and the choice persists
through the same `af_lang` localStorage + `UserProfile.preferredLanguage`
mechanism the rest of the app already uses — nothing new was built for
persistence.

## Bugs found and fixed during verification

- **Hero headline didn't translate.** First draft hardcoded `The
  <GradientWord>Intelligence Platform</GradientWord> for Fantasy Sports.`
  directly in JSX instead of reading from `copy.hero`, even though the
  `LANDING_COPY` object had a translated `headline` field per locale that
  was simply never used. Caught by switching the live preview to Spanish
  and seeing the headline stay in English while everything else
  translated. Fixed by splitting hero copy into `headlinePrefix` /
  `headlineGradient` / `headlineSuffix` per locale and reading all three
  from `copy.hero` in JSX, preserving the gradient visual treatment in
  every language. Re-verified in en/es/zh after the fix.
- **Two silent 404 links** (`/partnerships` on the Platform Intelligence
  card and the Licensing CTA) — caught by checking route existence before
  shipping rather than assuming the path was real. Fixed as described
  above under "Nav routing decisions."

## What was intentionally not included

- **German language support** — not supported anywhere in the app; see
  "Language behavior" above.
- **A `/partnerships` or `/licensing` marketing route** — doesn't exist
  today; building one is a real scope decision outside a landing-page
  copy/visual redesign, so both CTAs route to the one real contact
  channel instead (`mailto:support@allfantasy.ai`).
- **The World Cup Pools hero promo CTA** — removed from the hero only, to
  match the ticket's clean two-CTA spec; the feature/route is untouched.
- **A real "Watch Overview" video** — no such asset exists; the CTA
  scrolls to the product cards instead of linking to nothing or inventing
  video infrastructure.
- **Live Google Cloud Translation API wiring for this page** — explicit
  user decision this session; see "Language behavior."
- **DFS/gambling as a current consumer feature** — represented only as a
  small, clearly-labeled future/partner-facing note; no odds, no betting
  language, no promotion to users, per the ticket's explicit constraint.
- **Fixing `SeoLandingFooter.tsx`'s pre-existing broken links** — real,
  but unrelated to this ticket; flagged as a separate follow-up instead of
  bundled into this change.

## Tests run

- `npx vitest run __tests__/root-language-provider-layout.test.tsx` —
  **29/29 passed**. This is the only test file in the suite that reads
  `LandingPageClient.tsx` source directly (via `fs.readFileSync`, not a
  render test); it asserts the file keeps using `useOptionalLanguage`
  (provider-safe) and never calls the strict `useLanguage()` hook. Both
  hold after the rewrite.
- Confirmed via grep that no other test file imports or reads
  `LandingPageClient.tsx`, `app/page.tsx`, or its JSON-LD schema exports —
  there is no dedicated landing-page render/snapshot test in this repo
  beyond the one above.
- `npm run typecheck` (the project's 8GB-heap script — a bare `tsc
  --noEmit` reliably OOMs on this repo) — grepped the full output for
  both changed files (`LandingPageClient.tsx`, `app/page.tsx`) by path:
  **zero matches, zero new errors from this change.** Note for whoever
  picks this branch up next: the branch's working tree currently carries
  a very large amount of unrelated, uncommitted work (new engine
  directories, import-pipeline rewrites, AI analyzer changes, etc.), and
  the full typecheck run surfaced roughly 3,200 pre-existing error lines
  across that unrelated surface — dramatically more than the ~60-error
  baseline recorded earlier in this same session. That number reflects
  the state of other in-progress work on this branch, not this ticket;
  it's noted here so it isn't mistaken for something this change caused.
- Browser verification via the live dev server (Next.js 14.2, compiled
  clean, zero errors beyond pre-existing/unrelated Meta CAPI placeholder
  noise and FB SDK http-page warnings):
  - **Dark mode**: full page, hero through footer — verified visually.
  - **Light mode**: hero and mobile view — verified visually, high
    contrast, no readability issues.
  - **Language selector**: en → es → zh → fil (fallback) → en, headline
    and full page copy verified at each step via DOM text assertions and
    screenshots.
  - **Mobile (375×812)**: stacked hero, one product card per row,
    simplified header (logo + Sign In + Get Started Free only, center nav
    and language/theme controls correctly hidden below `md:`), sticky CTA
    bar visible and correctly positioned, light mode also checked at this
    width.
  - **Desktop (1440×900)**: confirmed structurally via DOM measurement
    (`getBoundingClientRect`, computed `display`) after the screenshot
    tool produced a stale/mis-scaled capture at this viewport size —
    center nav switches to `display: flex` above the `lg:` breakpoint,
    hero headline column width and position match the intended two-column
    grid. Noted as a screenshot-tool limitation at large viewports in this
    environment, not a page bug — DOM-level evidence confirms correct
    layout.
  - **CTA routing**: every CTA's rendered `href` checked directly
    (nav Sign In/Get Started, hero primary/secondary/sign-in, all four
    product cards, licensing CTA, mobile sticky bar) — all resolve to the
    correct auth-intent URLs, real routes, in-page anchors, or the
    corrected `mailto:` link; none 404.
  - **No gambling-forward or AI-forward copy**: confirmed by direct
    reading of final `LANDING_COPY` content and rendered DOM text: "AI"
    does not appear anywhere in visible copy, page title, or meta
    description; DFS/gambling appears only in the small future-verticals
    note with compliance-gated language.
  - **Auth links unbroken**: Sign In → `/login?callbackUrl=%2Fdashboard`,
    Get Started Free → `/signup?next=%2Fdashboard&callbackUrl=%2Fdashboard`
    — both unchanged from the pre-redesign implementation, confirmed via
    `loginUrlWithIntent`/`signupUrlWithIntent` reuse (no new auth logic
    written).

## Files changed

- `components/landing/LandingPageClient.tsx` — full rewrite of copy
  object and JSX structure. Preserved unchanged: `signupUrlWithIntent`/
  `loginUrlWithIntent` auth routing, `trackLandingCtaClick` analytics
  calls (extended to new CTAs, not replaced), the admin-check effect, the
  `isAuthenticated` branching, the `mode-readable` root class, and the
  decorative `landing-grid` background style.
- `app/page.tsx` — metadata only (`title`, `description`, OG/Twitter
  tags, `keywords`, both JSON-LD schema descriptions) rewritten to
  non-AI-forward Intelligence Platform language. Redirect logic, the
  SSR-disabled dynamic import (Windows Next 14.2 workaround), and
  `LandingInviteCapture` untouched.
- `docs/LANDING_PAGE_INTELLIGENCE_PLATFORM_REDESIGN.md` — this file.

## Required env vars

None added. This page uses static pre-translated copy, not a live
translation API call — see "Language behavior" for why. The app-wide
Google Translate integration (`GOOGLE_TRANSLATE_API_KEY`, consumed by
`lib/i18n/google-translate-server.ts` and `app/api/i18n/translations/
route.ts`) already exists independently of this page and is undisturbed;
it was not wired into this file and requires no new documentation here.

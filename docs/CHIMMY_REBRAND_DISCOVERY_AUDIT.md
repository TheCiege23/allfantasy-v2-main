# Chimmy Rebrand — Full-Product Discovery Audit

**Status:** discovery only, no code changes made · **Prepared:** 2026-07-16 · **Branch:** `claude/chimmy-rebrand-discovery-audit`

## Summary

Re-running the no-AI-copy guard's detection logic (unscoped, across `app/**` + `components/**`, same exclusions the committed guard uses for `admin`/`dev`/`internal`/tests) found **485 files** with literal "AI" copy, and a **separate** filename/directory scan found **253 files** whose own name or containing directory carries "AI." These overlap partially but are different problems: one is about what customers *read*, the other is about what customers (or developers) *see in a path*.

The 485/253 numbers are larger than the original 342 — the guard's detector improved since that number was taken (it now also catches JSX text nodes Prettier wraps onto their own line, the same gap fixed during Runbook A's seed-verification), so this scan is a superset of the original finding, not a discrepancy.

**The single biggest reframe this audit produces:** most of the "partial-rename" surface is *not* customer-facing at all. Of 253 filename/directory hits, 163 are backend API route directories and 80 are internal component directories — 243 of 253 are paths a customer never sees as literal text. Only **9 files**, across two route directories (`/ai` and `/ai-chat`), are actual customer-visible URL segments. Renaming the internal 243 is a large, real refactor with **zero direct branding payoff** — it's a code-hygiene question, not a rebrand question. Treat these as separate decisions.

## Methodology

- Scope: `app/**` + `components/**`, `.ts`/`.tsx` only, excluding `admin/`, `dev/`, `internal/`, `__tests__/`, `node_modules/` — the same exclusions as the committed `__tests__/no-ai-customer-copy.test.ts`.
- Content detector: same mechanism as the committed guard — quoted-string matches, same-line JSX text, and bare-text-line (multi-line JSX text) — checking for `\bAI\b` or known phrases, skipping comments/imports/console calls.
- Filename detector: a separate pass checking every scanned file's path segments for `ai` as a directory name, an `ai-`/`-ai` segment, or a PascalCase `AI` token in the filename itself (e.g. `AIHubPage.tsx`).
- No files were renamed or edited. Two scratch Node scripts did the scanning; the underlying data (485-file list with matched strings, 253-file filename list, per-directory fan-out samples) is available on request but not committed — this report is the deliverable.

---

## Bucket 1 — SEO/metadata surface (3 files)

Highest-visibility, lowest-risk bucket: pure copy, no code-structure change, but seen on every page load / search result snippet.

- `app/layout.tsx` — root SEO title (`AllFantasy – AI Powered Fantasy Sports Tools`) and description, shown on every page.
- `app/app/head.tsx` — the Sports App section's own title/description override (`AllFantasy Sports App — AI Fantasy Sports Tools & Trade Analyzer`).
- `app/trade-analyzer/head.tsx` — Trade Analyzer's own title/description override (`AllFantasy Trade Analyzer — AI Fantasy Trade Analysis Tool`).

The brief anticipated one file here; the scan found two more `head.tsx` overrides with the same pattern.

## Bucket 2 — Likely-intentional pages (5 files)

Don't fix without a product decision — each has a plausible reason to say "AI" on purpose:

- `app/ai-transparency/page.tsx` — a dedicated AI-disclosure page. Title is literally "AI Transparency." Reads as deliberate by definition.
- `app/mission/page.tsx` — philosophy/mission statement ("AI should help, not replace"). Reads as a deliberate positioning statement, not a slip.
- `app/disclaimer/page.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx` — **not in the original brief, found by this scan.** Legal/compliance pages describing what the product does ("AllFantasy provides AI-powered fantasy sports analysis..."). Plausible these need factual, precise language for legal reasons rather than brand voice — but that's a legal-review question, not mine to assume. Flagging rather than bucketing as safe.

## Bucket 3 — Established product names to preserve (~30 files)

"Waiver AI" and "AI Trade Analyzer" (confirmed during Runbook A) are used consistently as feature names, not generic mentions. Re-scanning the full 485 for these two phrases (case-insensitive) found them in ~30 files. No other similarly-established "X AI" proper noun turned up at comparable frequency on this pass — everything else reads as incidental generic phrasing, not a named feature.

Representative files: `app/dashboard/components/AIToolsModal.tsx`, `app/dashboard/components/LegacyToolsetGrid.tsx`, `app/api/waiver-ai/route.ts`, `app/api/waiver-ai/engine/route.ts`, `components/ActionHandoffButtons.tsx`, `components/meta-insights/PlayerTrendPanel.tsx`, `components/waiver-wire/WaiverWirePage.tsx`, `components/AIFeaturesPanel.tsx`, `app/league/[leagueId]/components/LeagueSettingsModal.tsx`, `app/trade-evaluator/page.tsx`, `app/trade-analyzer/head.tsx`, `components/app/draft-room/DraftPickTradePanelRoot.tsx`, `components/chimmy-surfaces/surfaces/WaiverAISurface.tsx`, `components/app/settings/AISettingsPanel.tsx`, `components/ai-hub/AIHubPage.tsx`, `components/landing/ToolPreviewCards.tsx`.

**Important nuance:** roughly half of these files are "mixed" — they contain a legitimate "Waiver AI"/"AI Trade Analyzer" mention *and* separate, unrelated generic "AI" copy that likely does need the Chimmy fix. E.g. `app/dashboard/DashboardContent.tsx` says "Waiver AI" (keep) and also "Open AI" / "your first AI action" (already fixed on a separate branch this session). This means eventual remediation here has to happen **per-string, not per-file** — you can't blanket-allowlist or blanket-fix a whole file in this bucket.

## Bucket 4 — Bot-opponent / computer-controlled-team terminology (26 files, not in the original brief)

A second, genuinely different meaning of "AI" turned up: computer-controlled fantasy teams — auto-drafting, filling empty rosters, autopick. This is unrelated to the Chimmy-assistant brand rule; "AI" here means something closer to "CPU" or "bot" (one file literally says "CPU fallback" as a synonym in the same string). Examples: `components/league/AiManagedTeamBadge.tsx` ("This team is managed by an AllFantasy AI opponent"), `components/league-feed/BotPersonalityBadge.tsx`, `app/api/leagues/[leagueId]/orphaned-teams/assign-ai/route.ts`, `app/api/commissioner/leagues/[leagueId]/managers/assign-ai/route.ts`, `components/league-settings/AiOpponentsCommissionerSection.tsx`, `app/settings/components/sections/AISettingsSection.tsx`, `components/mock-draft/MockDraftSleeperRoomClient.tsx`, and 19 others (mostly `app/api/**/ai/opponents/**`, `**/autopick**`, `**/assign-ai/**`).

Whether this should say "Bot"/"CPU"/something else instead of "AI" is a *different* product-naming question than the Chimmy rebrand — flagging for awareness, not folding into the generic-bug count.

**Ambiguous, needs a closer read (not auto-classified with confidence):**
- `components/app/commissioner/CommissionerMonetizationOverview.tsx` — "AI collusion detection" could mean either "an algorithm that detects collusion" (Chimmy-adjacent) or "collusion involving bot-controlled teams." Unclear from the extracted string alone.
- `components/league/LeagueAISettingsPanel.tsx` — has both bot-opponent strings and what read as generic AI-analysis-feature strings ("AI-generated weekly league power rankings"); likely mixed content, not cleanly one bucket.

## Bucket 5 — The AF Legacy surface: a whole parallel "AI" voice (not in the original brief)

`app/af-legacy/**` (and its ~9 component files) isn't a handful of stray mentions — `app/af-legacy/page.tsx` alone has **over 90 distinct matched strings**: "AI Report Card," "AI Coach," "AI Trade Hub," "Ask AI about your roster," "AI is learning — built to get smarter from real user feedback," and so on, throughout. This reads as an entire preview surface that built its own "AI-forward" voice (its own copy literally says "AF Legacy is a live preview of the AI powering the AllFantasy app launching in 2026") — predating or running parallel to the Chimmy brand, not a set of individually-slipped bugs.

Affected: `app/af-legacy/page.tsx`, `app/af-legacy/layout.tsx`, `app/af-legacy/trade-analyzer/page.tsx`, `app/af-legacy/components/ChimmyChatTab.tsx`, `app/af-legacy/components/OverviewInsights.tsx`, `app/af-legacy/components/legacy-tab-label.ts`, `app/af-legacy/components/tabs/LegacyChatIntro.tsx`, `app/af-legacy/components/tabs/LegacyWaiverTabIntro.tsx`, `app/af-legacy/components/mock-draft/DraftRoom.tsx`, `app/af-legacy/components/mock-draft/MockDraftBoard.tsx`.

**Recommendation:** treat this as its own dedicated pass, not folded into "generic copy bugs" — the volume and consistency suggest a deliberate voice that needs a product decision (retire the surface, rebrand it wholesale to Chimmy, or leave it as an intentionally-distinct "AI Legacy preview" identity) rather than 90+ individual string edits.

## Bucket 6 — Generic copy bugs (422 files, the residual)

Everything left over after buckets 1–5: incidental "AI" mentions in UI text, tooltips, empty states, error messages, and marketing copy that aren't tied to a specific established name and aren't one of the above. This is the closest analog to the 3 dashboard bugs already fixed (bare "AI" that should say Chimmy).

Grouped by top-level area (142 distinct directories total; full flat file list follows):

| Area | Files | Area | Files |
|---|---|---|---|
| `app/api/**` (non-bot-opponent, non-established-name routes) | 72 | `components/app/**` | 40 |
| `app/league/**` | 16 | `app/components/**` | 13 |
| `components/brackets/**` | 13 | `components/ai-tools/**` | 10 |
| `components/chimmy-surfaces/**` | 9 | `components/league-creation-wizard/**` | 9 |
| `app/af-legacy/**` (residual, outside Bucket 5's core cluster) | 7 | `components/survivor/**` | 7 |
| `app/app/**` | 6 | `components/tournament/**` | 6 |
| `app/ai/**`, `app/brackets/**`, `app/idp/**` | 5 each | `components/bracket/**`, `components/matchup-center/**` | 5 each |
| ~120 more directories | 1–4 files each | | |

<details>
<summary>Full file list (422 files) — click to expand</summary>

See the companion listing generated for this audit; every file above the fold has 1+ matched string (quoted string, same-line JSX text, or bare multi-line JSX text). Representative high-density examples, one per notable area:

- `app/api/ai/chat/route.ts` — "AI assistant is temporarily disabled by platform configuration.", "No response from AI"
- `components/app/draft-room/DraftHelperIntelligence.tsx`, `DraftHelperPanel.tsx`, `DraftChatPanel.tsx` and 37 more `components/app/**` files — draft-room and settings UI, mostly tooltip/empty-state copy
- `app/league/[leagueId]/tabs/AICoachingTab.tsx`, `WarRoomTab.tsx` and 14 more `app/league/**` files — league tab copy
- `components/brackets/world-cup/WorldCupMatchupIntelligencePanel.tsx`, `WorldCupCommissionerBrainPanel.tsx` and 11 more — World Cup bracket copy
- `components/chimmy-surfaces/surfaces/AdminAISurface.tsx`, `CommissionerAISurface.tsx`, `DashboardAISurface.tsx`, `DraftRoomAISurface.tsx`, `LeagueHomeAISurface.tsx`, `MatchupAISurface.tsx`, `PlayerAISurface.tsx`, `RosterAISurface.tsx`, `TradeAISurface.tsx` — notably, these files live in a directory literally named `chimmy-surfaces/` but the individual files are still named `*AISurface.tsx` and contain "AI" copy; this looks like a rebrand that renamed the parent directory but not the files inside it or their copy.

The remaining ~350 files span nearly every feature area (settings panels, empty states, onboarding, tooltips, marketing/landing copy) at 1–3 matches each — see the per-bucket breakdown above for full directory counts.

</details>

---

## Partial-rename directories/files (253 total — a separate axis from the content buckets above)

A file/directory can need a rename, a content fix, both, or neither — this is tracked separately from Buckets 1–6.

### Customer-visible URL segments (9 files — the only subset with real customer-facing rename value)

| File | URL segment | Import fan-out |
|---|---|---|
| `app/ai/layout.tsx` | `/ai` | n/a (Next.js route file, not imported) |
| `app/ai/page.tsx` | `/ai` | n/a |
| `app/ai/history/page.tsx` | `/ai/history` | n/a |
| `app/ai/saved/page.tsx` | `/ai/saved` | n/a |
| `app/ai/tools/page.tsx` | `/ai/tools` | n/a |
| `app/ai/tools/AIToolsPageClient.tsx` | (client component for `/ai/tools`) | 1 file |
| `app/ai-chat/page.tsx` | `/ai-chat` | n/a |
| `app/waiver-ai/layout.tsx`, `app/waiver-ai/page.tsx` | `/waiver-ai` | n/a — **likely should stay**, see below |

`/waiver-ai` and `/ai-transparency` (also in this list) are arguably **not** rename candidates at all: "Waiver AI" is a confirmed established product name (Bucket 3), and `/ai-transparency` is a likely-intentional page (Bucket 2). That leaves the real customer-visible rename surface at just **`/ai` (+ 4 sub-routes) and `/ai-chat`** — 6 files, not 9.

Page/layout files in Next.js App Router aren't imported by other code (Next finds them by folder convention), so "import fan-out" doesn't apply to them directly — the real cost is a URL change: existing bookmarks/shared links to `/ai/*` and `/ai-chat` would need redirects, and any hardcoded internal `<Link href="/ai...">` references need updating (not counted here; a follow-up grep, not done in this pass since it's a rename action, not discovery).

### Internal API route directories (163 files, 0 import fan-out)

These are **never customer-visible as literal text** — a browser never renders `/api/ai/chat` to a user. Confirmed directly: zero files anywhere in `app/`, `components/`, or `lib/` import anything from `app/api/ai/**` (routes are invoked via `fetch()` URL strings, not TypeScript imports). Renaming these has no direct branding benefit — it's pure internal consistency, and the real effort isn't "import fan-out" but "how many client-side `fetch()` call sites reference this URL string," which has no compiler safety net and is a materially bigger, riskier undertaking than a typical rename.

- `app/api/ai/**` — 57 route files (by far the largest single cluster)
- `app/api/leagues/**` (nested `ai`/`ai-*` segments) — 24
- `app/api/ai-tools/**` — 11
- `app/api/draft/**` — 9
- `app/api/guillotine/**` — 8
- `app/api/redraft/**` — 8
- `app/api/keeper/**` — 7
- `app/api/bestball/**` — 6
- `app/api/commissioner/**` — 4
- `app/api/bracket/**`, `app/api/waiver-ai/**` — 3 each
- 18 more directories at 1–2 files each

**Recommendation: don't rename these for the rebrand.** If there's a separate code-hygiene motivation, that's a distinct initiative with its own cost/benefit case — not part of a customer-facing branding effort.

### Internal component directories (80 files, 1–3 import fan-out each)

Also never customer-visible as literal text (a directory name isn't rendered), but unlike API routes, these genuinely are imported — fan-out is real and was sampled directly:

| Directory | Files | Sampled fan-out |
|---|---|---|
| `components/ai/**` | 19 | — |
| `components/ai-tools/**` | 18 | `AIToolCard`: 3 files |
| `components/ai-interface/**` | 14 | `AIModeSelector`: 1 file |
| `components/ai-evidence/**` | 10 | via barrel: 2 files |
| `components/ai-confidence/**` | 7 | via barrel: 1 file |
| `components/ai-hub/**` | 6 | `AIHubPage`: 1 file; via barrel: 2 files |
| `components/ai-insight-cards/**` | 3 | via barrel: 1 file |
| `components/ai-player-comparison/**`, `components/ai-reliability/**` | 1 each | — |

Every sampled component has low (1–3) fan-out — these are self-contained feature areas, not deeply-threaded shared infrastructure. If a rename is ever undertaken, each directory is a bounded, independent unit of work (rename + update its handful of importers), unlike the API-route bucket where the "importer" count is structurally invisible to static analysis.

---

## Suggested sequencing recommendation

1. **SEO/metadata (Bucket 1, 3 files)** — pure copy, zero code risk, highest visibility (every page load). Do this first, same-day turnaround.
2. **Generic copy bugs outside AF Legacy (Bucket 6, ~415 files after excluding the AF Legacy cluster)** — same shape as the 3 dashboard bugs already fixed; mechanical, low-risk, but needs the same "seed a violation, verify the guard catches it" discipline the dashboard guard used, expanded surface by surface (this pass already showed the detector itself has room to miss things).
3. **The AF Legacy surface (Bucket 5)** — needs a product decision first (retire / rebrand / keep distinct), not a string-by-string fix. Don't start editing until that's decided.
4. **Customer-visible URL renames (`/ai`, `/ai-chat` — 6 files)** — real customer impact, low fan-out, but needs redirects for existing links/bookmarks. Worth doing, but plan the redirect step alongside it.
5. **Internal component directory renames (80 files)** — bounded effort per directory, zero direct branding payoff. Only worth doing if there's a separate code-hygiene motivation; not urgent for the rebrand itself.
6. **Internal API route renames (163 files)** — do this last, if ever. No customer-facing benefit, the largest single bucket, and the riskiest (fetch-call-site fan-out has no compiler safety net, unlike a TS import rename).
7. **Bot-opponent terminology (Bucket 4, 26 files) and Established-product-names (Bucket 3, ~30 files)** — not bugs. Route to a product-naming decision, not an engineering task, the same way "Waiver AI" was handled in Runbook A.

## Explicit ambiguous callouts (don't guess, don't auto-fix)

- `components/app/commissioner/CommissionerMonetizationOverview.tsx` and `components/league/LeagueAISettingsPanel.tsx` — mixed bot-opponent/generic content, see Bucket 4.
- `app/disclaimer/page.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx` — plausible-intentional legal copy, but unlike `ai-transparency`/`mission` these weren't in the original brief's "likely intentional" list; worth a legal/compliance read before assuming either way.
- Every file in Bucket 3 flagged "mixed" — contains both an established product name (keep) and separate generic bugs (likely fix) in the same file; any future fix pass here must work per-string, not per-file.
- The `components/chimmy-surfaces/surfaces/*AISurface.tsx` naming pattern (Bucket 6) — files living in a directory already renamed to `chimmy-surfaces/` but individually still named and worded around "AI." Reads like a rebrand that renamed the parent directory and stopped there.

## Explicitly out of scope (per the brief)

No files were renamed, no copy was edited, no `available`/config flags were changed. This document is the catalog; scope and sequencing decisions are separate next steps.

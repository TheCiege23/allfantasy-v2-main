# AllFantasy — Standing Requirements & Workstreams

**What this is:** the durable rules and open workstreams from Guap's direction, so every future build honors them by default. Principles P1–P4 apply to *everything we create*. Workstreams W1–W5 are discrete efforts, each with its own first step. Nothing here is lost between sessions.
**Last updated:** Jul 15, 2026.

---

## Always-on principles (apply to every page, deliverable, and prompt)

### P1 — Never use the word "AI" in anything a customer sees
The letters "AI" carry a stigma (anti-human, scary). Outside of internal engineering docs, **do not use "AI."** Use instead: **Coach, Assistant, Helper, Command Center, OS, Dashboard, Insights, Intelligence** (as a feeling, not the tech).
- **Applies to:** all UI copy, buttons, tooltips, marketing, landing pages, app-store listing (ASO), emails, social.
- **Exception:** internal engineering artifacts (this repo's `AF_*.md` handoffs, code comments) may name the real tech (LLM, model, GPT-4o) for accuracy — customers never see those.
- **Status:** landing copy + positioning are already clean. **Open:** audit the live app's user-facing strings for "AI" leakage (W-audit below).

### P2 — 5-second clarity (marketing + retention priority)
Every page must answer, within 5 seconds: **What is this? Why should I care? What do I do next?**
- One clear "page promise" line near the top of every screen.
- One primary action per page. If a visitor can't tell the point in a glance, the page fails.

### P3 — Visually stunning, but simple
Premium dark command-center look — layered, polished — but **one point per page.** The more a page shows, the more the point gets lost. When in doubt, cut. Whitespace and focus over density (except intentional data-dense surfaces like the command center).

### P4 — SEO + ASO forward on every page
Discovery is oxygen. Every page ships with: a unique `<title>` and meta description, Open Graph/Twitter cards, semantic headings (one `<h1>`), structured data (JSON-LD where relevant), fast load, and clean URLs. App-store listing optimized for ASO keywords (fantasy football, league manager, multi-platform, etc.).

---

## Open brand decision (blocking full visual cohesion)

Your real logo is **navy + cyan/blue + white**; the current mockups use **purple** as the accent (from the original brief). A blue logo next to purple buttons reads slightly off. **Decision needed** (see the question I'll ask): align the site accent to the logo's blue/cyan (most cohesive), keep purple as a deliberate second color, or recolor the logo to purple. Once chosen, I'll apply it across the command center, landing page, and every future build.

---

## Workstreams

### W1 — Legal & compliance protection  ⚠ priority · needs a lawyer
**Honest take:** I can draft strong starting templates and a checklist, but **an attorney must review before launch** — especially the 3rd-party data question. Importing from ESPN/Yahoo/Sleeper is governed by each platform's Terms of Service and API rules; what you may store, display, and monetize varies, and getting it wrong is the kind of risk that can end a product. This is not a place to guess.
**You already have** (per the app's routes): `/privacy`, `/terms`, `/disclaimer`, `/no-gambling-policy`, `/data-deletion`, `/geo-blocked`. Good foundation.
**What's needed / to verify:**
- A clear **"not affiliated with" disclaimer**: AllFantasy is independent; ESPN, Yahoo, Sleeper, NFL, NCAA, and all marks belong to their owners; no endorsement implied.
- **Data-source compliance**: confirm each platform's ToS/API terms permit import, storage, and display the way AF does it (Yahoo OAuth API terms, Sleeper API terms, ESPN's posture). **← the item for a lawyer.**
- Privacy policy covering GDPR/CCPA, OAuth data (Google/Spotify/Discord), and what's stored per imported league.
- Payments/subscriptions terms (Stripe), token terms, refund/"never charged when a tool fails" policy, and the external-escrow (LeagueSafe/FanCred) posture for dues.
- DMCA/acceptable-use, cookie notice.
**First step:** I audit your existing legal pages for gaps, draft the missing ones + the affiliation disclaimer, and produce a one-page "must be reviewed by counsel" list (data-source compliance at the top).

### W2 — Dead-code & asset cleanup (shrink repo, speed up deploys)
**Honest take:** your push/deploy is slow almost certainly because build artifacts and logs are in the tree, not because of source size. Your brief's rule stands: **audit before deleting, protect proven-live paths.** So this is a two-tier cleanup.
- **Tier 1 (safe now):** the repo root is full of non-source debris — dozens of `.next-*` build dirs, `build-*.log`, `typecheck-*.txt`, `.tmp-*` files, `test-results`, `lint-report.json` (9.8 MB!), old `PROMPT_*_DELIVERABLE.md`. These should be **`.gitignore`d and removed from the tree** — zero risk, big size win, faster pushes.
- **Tier 2 (careful):** actually-unused routes/components/libs (e.g. the dormant `lib/ranking/*` engine, dead `newsapi-ingestion.ts`, the fake yearly-XP code — all already flagged in your provenance audit). These need an import-graph check before deletion so nothing proven-live breaks.
**First step:** I produce a safe cleanup runbook — the exact `.gitignore` additions + `git rm --cached` list for Tier 1 (with size saved), then a verified Tier-2 dead-code list with a per-item "safe to delete because…" and a Claude Code prompt to remove them behind a build gate.

### W3 — Database correctness & integrity
**Honest take:** the live gap you already know about — **8 prod migrations with no source in git** (rescue Phase 12) — is the top DB-integrity risk. Beyond that: no schema drift, freshness monitors on ingested data, and idempotent, resumable jobs (your brief's own policy).
**First step:** a DB-integrity checklist — confirm prod schema == `prisma/schema.prisma`, commit the 8 orphaned migrations as source (Phase 12), and stand up freshness/drift monitoring (ties to the 22 orphaned cron routes finding).

### W4 — Integrations health (Google, Spotify, Discord, sports APIs, scoring, weather, FantasyCalc, Chrome)
**Honest take:** you have real integrations but no single place that says "all green / X is down." Cert #3 already gave you `/api/health/data-providers` for sports+weather — extend that idea to everything.
**First step:** an **integration health matrix** — for each (Google/Spotify/Discord OAuth, sports APIs, scoring, weather, FantasyCalc, Chrome extension): present/missing creds, callback-URL match (your brief lists the exact prod callbacks), a live reachability check, and last-success timestamp. Surfaced on your admin dashboard + a pre-launch checklist.

### W5 — Social growth & repurposing (Instagram, X, Facebook, TikTok, YouTube + ManyChat)
**Honest take:** this is marketing ops, and it pairs perfectly with the golden-path demo — one recording becomes a dozen clips. Keep this **AllFantasy-branded** and separate from ChimAura/CafeConChimmy (your brief's rule: don't blend the brands).
**First step:** a repurposing + ManyChat plan — turn the golden-path walkthrough into platform-native cuts (TikTok/Reels/Shorts vertical, X/FB posts), a posting cadence, and ManyChat automations (DM auto-replies → early-access capture). I'll also check the connector registry for ManyChat/social connectors so we can wire it, not just plan it.

---

## How these get enforced

- **P1–P4** become a checklist on every future deliverable — I'll self-check each build against them before delivering.
- **W1–W5** each get their own dependency-ordered runbook when you pick them up, same format as the certification pack.
- This register is the source of truth; update it as principles evolve or workstreams close.

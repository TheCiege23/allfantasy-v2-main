# AllFantasy — Legal Audit, Drafts & Counsel Checklist (Workstream W1)

**Prepared:** Jul 15, 2026 · by Cowork (strategic planner)
**⚠ Not legal advice.** I am not a lawyer. This audits what you have, drafts starting language, and — most importantly — tells you exactly what an attorney must review before launch. The items in §6 are not optional.

---

## 1. Executive summary

You're in a stronger position than most pre-launch products. You already have four real, substantive legal pages: **Terms of Service** (24 sections), **Privacy Policy** (10 sections, incl. CCPA), **Disclaimer**, and **No-Gambling Policy**, plus a **Data-Deletion** page. Your state-by-state fantasy-sports restrictions (Washington fully blocked; Hawaii/Idaho/Montana/Nevada paid-restricted) are genuinely thorough — better than many competitors.

Three priority gaps to close, and one thing that needs a lawyer above all else:

1. **No explicit "not affiliated with ESPN/Yahoo/Sleeper/NFL" disclaimer** — the exact 3rd-party protection you asked about. Draft is in §3, ready to paste.
2. **"AI" language throughout the legal copy** violates your no-"AI" rule (P1) and hurts your positioning. Exact find/replace in §4.
3. **A short list only counsel can close** — led by whether importing **ESPN** data complies with ESPN's Terms of Service. Details in §6.

---

## 2. Page-by-page audit

| Page | Route | State | Strengths | Gaps to fix |
|---|---|---|---|---|
| Terms of Service | `/terms` | **Strong** | Acceptable use, anti-collusion, geo-restrictions, warranty disclaimer, liability cap, indemnification, no-gambling, 3rd-party terms, legacy-import responsibility | "AI" in metadata + §2 + §6; governing law vague ("laws of the United States" — needs a specific state + arbitration/class-waiver — **counsel**); no non-affiliation/trademark clause; age says 18+ (Privacy says <13 — reconcile) |
| Privacy Policy | `/privacy` | **Good** | CCPA section, geographic-data handling, "we never store your passwords," 30-day deletion, no-sale statement | "AI" in metadata + §3 + §4; thin cookie coverage (one line — may need a standalone Cookie Policy); GDPR/UK not addressed (see §6); §2.3 lists APIs for Sleeper/Yahoo/MFL/Fantrax but **omits ESPN** while Terms §13 includes ESPN — inconsistent (see §6) |
| Disclaimer | `/disclaimer` | **Strong** | State-law compliance, no-gambling/DFS, league dues via external service, informational-only, user responsibility | "AI Tools" heading (P1); references FanCred only (brief also mentioned LeagueSafe — pick one or say "such as") |
| No-Gambling Policy | `/no-gambling-policy` | Present | Skill-based posture | (Confirm it cross-links Terms/Disclaimer; low risk) |
| Data Deletion | `/data-deletion` | Present | GDPR/CCPA deletion on-ramp | (Confirm it matches Privacy's 30-day claim) |

**Also good:** all pages share a `LegalPageRenderer` with a single `LEGAL_LAST_UPDATED` — clean, easy to keep current.

---

## 3. The 3rd-party protection you asked about

**What you already have (good):** Terms §13 (legacy import — user is responsible for having the right to provide the data), §16 (third-party platform terms apply), Privacy §2.3 ("publicly available" data via official APIs, no password storage). This is real coverage.

**What's missing (the important one):** an explicit **non-affiliation & trademark disclaimer**. Right now nothing on the site clearly states AllFantasy is independent. Add this block to the **Terms** (new section), the **Disclaimer**, and the **landing-page footer**:

> **Not affiliated with third-party platforms or leagues.**
> AllFantasy is an independent product. AllFantasy is not affiliated with, endorsed by, sponsored by, or in any way officially connected to ESPN, Yahoo, Sleeper, MyFantasyLeague (MFL), Fantrax, Fleaflicker, the National Football League (NFL), the NCAA, or any of their subsidiaries or affiliates. All team names, league names, player names, logos, and trademarks are the property of their respective owners and are used for identification and descriptive purposes only. Use of these names does not imply any affiliation or endorsement.

**Why it matters:** it reduces trademark/passing-off exposure, and it's the standard shield every neutral aggregator uses. It costs you nothing and protects the brand. (Still have counsel confirm the exact wording — see §6.)

---

## 4. Remove "AI" from the legal copy (P1) — exact changes

These are customer-facing and must change. The trick: keep the *legal substance* (content is automated, informational-only, not guaranteed) while dropping the "AI" branding. Suggested replacements:

| File / location | Current | Change to |
|---|---|---|
| `terms/page.tsx` metadata | "AI-powered fantasy sports platform" | "the all-in-one fantasy sports command center" |
| `terms/page.tsx` §2 | "AI-powered fantasy sports analysis" | "automated fantasy sports analysis" |
| `terms/page.tsx` §6 heading | "AI Use Policy" | "Automated Tools & Recommendations Policy" |
| `terms/page.tsx` §6 body | "Our AI tools…", "AI-generated content" | "Our automated tools…", "automatically generated content" |
| `privacy/page.tsx` metadata | "AI-powered fantasy sports platform" | "the all-in-one fantasy sports command center" |
| `privacy/page.tsx` §3 | "To generate AI-powered analysis and recommendations" | "To generate automated analysis and recommendations" |
| `privacy/page.tsx` §4 heading | "AI and Machine Learning" | "Automated Analysis & Personalization" |
| `privacy/page.tsx` §4 body | "We use AI to analyze…", "AI-generated content" | "We use automated systems to analyze…", "automatically generated content" |
| `disclaimer/page.tsx` heading | "AI Tools and Guidance" | "Automated Tools & Guidance" |
| `disclaimer/page.tsx` body | "Our AI tools…", "AI analysis" | "Our automated tools…", "automated analysis" |

> **Note for legal accuracy:** "automated" is actually the *stronger* legal word here — several privacy frameworks (e.g. GDPR Art. 22) speak in terms of "automated processing/decision-making," so this wording both honors your no-"AI" rule and reads as more precise. Keep the "not guaranteed / informational only / at your own risk" substance exactly as-is.

**Scope beyond these pages:** "AI" almost certainly appears in other customer-facing strings across the app (buttons, headings, tooltips, page titles, the app-store listing). P1 is app-wide. Ready-to-run audit prompt for your executor:

```
Find every CUSTOMER-FACING use of "AI" in the app and replace it with approved wording
(Coach, Assistant, Helper, Command Center, OS, Dashboard, Insights, automated, intelligent),
preserving legal substance. Do NOT change internal code identifiers, comments, or the AF_*.md
handoffs.

STEPS:
1. grep -rniE "\bAI\b|AI-powered|AI-generated|artificial intelligence" app/ components/ --include=*.tsx --include=*.ts
   Filter to strings rendered to users (JSX text, aria-labels, titles, metadata, toasts) — NOT
   variable/function names or comments.
2. Replace per the approved-wording map. For legal pages use §4 of AF_LEGAL_AUDIT_AND_DRAFTS.md.
3. Also fix <title>/meta description on every page for P1 + SEO (see the SEO workstream).
4. Build gate: npm run typecheck && npm run build clean; screenshot 3-4 changed surfaces.

FORBIDDEN: renaming code symbols, editing internal .md handoffs, changing legal meaning.
DEFINITION OF DONE: zero customer-facing "AI" strings remain; build green; screenshots captured.
```

---

## 5. New / upgraded documents to add

- **Cookie Policy** (standalone or a fuller Privacy section): what cookies, categories (essential/analytics/marketing — you use GA4 + Meta Pixel per the brief), and a consent mechanism. If you serve any EU/UK/California traffic, a consent banner is likely required — **counsel to confirm.**
- **Arbitration + governing law + class-action waiver** (in Terms): currently vague. Pick a home state; counsel drafts the clause. This materially limits your litigation exposure.
- **Age consistency**: Terms says 18+, Privacy says "not intended for under 13." For a fantasy product, standardize on **18+** across both (cleaner, avoids COPPA entirely). Counsel to confirm.
- **Payments/refunds** (Stripe subscriptions + tokens): a short terms section covering billing, renewals, refunds, and your brief's promise that "users are never charged when a tool fails." Tie to Stripe's required disclosures.
- **DMCA / copyright agent** notice if you host user-generated content (chat, league ideas).

---

## 6. ⚠ MUST be reviewed by a licensed attorney (in priority order)

**Do not launch broadly without these. #1 is the one that can actually hurt you.**

1. **Third-party data-source compliance — the big one.** Your Privacy §2.3 says data comes from "official APIs (Sleeper, Yahoo, MFL, Fantrax)" — but it **omits ESPN**, while your Terms §13 and your actual import layer include **ESPN** (and Fleaflicker). ESPN has **no official public fantasy API** — imports typically use unofficial/undocumented endpoints, which can conflict with ESPN's Terms of Service. **A lawyer must review, per platform, whether your import method is permitted**, and your public copy must match reality (don't claim "official API" for a source that isn't one). This is the single highest legal risk in the product and the exact thing you flagged.
2. **Governing law, venue, arbitration & class-action waiver** — pick a state; counsel drafts.
3. **GDPR / UK-GDPR applicability** — your OAuth logins (Google, Discord, Spotify) can bring in non-US users even if fantasy features are US-geo-restricted. Counsel decides whether you need GDPR language, a DPA, and a cookie-consent banner.
4. **CCPA "Do Not Sell / Share" mechanism** — you state you don't sell; counsel confirms whether GA4/Meta Pixel sharing triggers "sharing" obligations and whether you need the link/toggle.
5. **Trademark/nominative fair use** — confirm the §3 non-affiliation wording and that your use of platform/league names qualifies as nominative fair use.
6. **Payments & consumer-protection** (Stripe subscriptions, tokens, refunds, auto-renewal disclosure laws like California's ARL).
7. **Entity & liability** — is there an LLC/Inc behind "AllFantasy"? The liability caps and indemnification are far stronger with a formed entity. Counsel/accountant.

---

## 7. What I can do now vs. what waits for counsel

**I can apply now (low-risk, your call):**
- Add the §3 non-affiliation disclaimer to Terms, Disclaimer, and the landing footer.
- Apply the §4 "AI"→"automated" replacements to the three legal pages.
- Reconcile the age statement to 18+ and the FanCred/LeagueSafe wording.
- Fix the "AI-powered" metadata (helps P1 **and** SEO).

**Waits for counsel (§6):** ESPN/data-source compliance, arbitration/governing law, GDPR/CCPA mechanisms, entity formation.

Want me to apply the "now" list to your actual pages (as precise edits behind a build gate) and add the non-affiliation block to the landing footer? Say the word and I'll prepare them.

---

*This closes the first pass of Workstream W1. The register (`AF_STANDING_REQUIREMENTS.md`) tracks the rest.*

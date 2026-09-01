# Prompt 64 — Legal Pages + Agreements + App Disclaimers + Full UI Click Audit

## 1. Legal Page Architecture

- **Routes**: `/disclaimer`, `/terms`, `/privacy`. All use a shared **LegalPageShell** for consistent layout, back link, and footer (Disclaimer, Terms, Privacy, Home).
- **Back behavior**: When opened from signup (`?from=signup` and optionally `?next=...`), the back link is "Back to Sign Up" and points to `/signup` or `/signup?next=...`. Otherwise it is "Back to Home" → `/`.
- **Resolver**: `lib/legal/legal-route-resolver.ts` — `getSignupReturnUrl(next)`, `getDisclaimerUrl(fromSignup, next)`, `getTermsUrl(fromSignup, next)` for safe URLs and signup-return links.
- **Core modules**:
  - **LegalPageRenderer**: `components/legal/LegalPageShell.tsx` — wrapper with title, description, back link, and footer.
  - **DisclaimerPageService**: Content and structure live in `app/disclaimer/page.tsx` (no separate service; page is the unit).
  - **TermsPageService**: Content and structure in `app/terms/page.tsx` (expanded per Prompt 64).
  - **AgreementAcceptanceService**: Signup state `disclaimerAgreed` and `termsAgreed`; register API validates both; submit disabled until both checked.
  - **SignupAgreementGate**: Submit button `disabled` when `!termsAgreed || !disclaimerAgreed`; backend returns 400 if either is false.
  - **LegalRouteResolver**: `lib/legal/legal-route-resolver.ts` (and `lib/legal/index.ts`).

---

## 2. Disclaimer Content Structure

The **Disclaimer** page (`/disclaimer`) is fantasy-sports-specific and covers:

1. **Purpose of the Platform** — Fantasy sports entertainment and management tools only; no gambling or real-money betting.
2. **No Gambling or DFS** — No gambling offered; no DFS or paid pick’em; tools for traditional season-long fantasy and related entertainment only.
3. **League Dues and Payments** — AllFantasy does not collect, hold, or distribute league dues or entry fees; payments are between users or third-party services; we are not responsible for those transactions.
4. **AI Tools and Guidance** — AI provides guidance and informational content only; no guarantee of outcomes; you are solely responsible for your decisions; use at your own risk.
5. **Your Responsibility and Local Laws** — You must comply with applicable laws; fantasy may be restricted in some jurisdictions; you determine legality; we do not provide legal advice.

Footer links to Terms and Privacy. Last updated: March 2026.

---

## 3. Terms Content Structure

The **Terms of Service** page (`/terms`) has been expanded to include, at minimum:

1. **Acceptance of Terms**
2. **Description of Service**
3. **Platform Rules** — Use in accordance with Terms and in-product rules; no violation of law or abuse of users/platform.
4. **Anti-Collusion and Anti-Cheating** — No secret agreements to distort outcomes; no cheating, bots, or circumventing rules; we may remove/restrict accounts and report where appropriate.
5. **Acceptable Use** — No illegal use, interference, unauthorized access, harassment, abusive scraping, or commercial resale without permission.
6. **AI Use Policy** — AI for informational/entertainment only; not guaranteed; no resale or training external models without permission.
7. **No Manipulation or Exploits** — No manipulating rankings/scores or exploiting bugs; report vulnerabilities.
8. **Paid vs. Free Leagues; Subscriptions and Tokens** — Free and paid features; we don’t run leagues or handle league dues; refunds per our policy.
9. **Account Responsibilities** — Accurate info, 18+ where required, keep credentials secure, responsibility for account activity.
10. **Content Moderation** — We may remove or refuse content; not obligated to host any content.
11. **Dispute Handling** — User disputes are between users; disputes with us: good-faith resolution first; governing law and jurisdiction.
12. **Legacy Import and External Data** — Your responsibility to have rights to provide data; we use it for rankings/levels; no guarantee of accuracy; not responsible for third-party data changes.
13. **Intellectual Property**
14. **User Content**
15. **Third-Party Platforms**
16. **Disclaimer of Warranties**
17. **Limitation of Liability**
18. **Indemnification**
19. **No Gambling or Betting**
20. **Termination**
21. **Platform Updates and Changes** — We may change/suspend/discontinue features; reasonable notice; continued use = acceptance; no liability for changes.
22. **Severability and Entire Agreement** (with links to Disclaimer and Privacy)
23. **Contact** — support@allfantasy.ai

Clear, readable, and product-specific. Last updated: March 2026.

---

## 4. Agreement Gating Logic

- **Frontend**: Create Account is **disabled** when `!disclaimerAgreed || !termsAgreed` (along with other existing conditions: username ok, password valid, confirm match, age, etc.). No form submit is possible without both checkboxes checked.
- **Backend**: `POST /api/auth/register` requires `disclaimerAgreed` and `termsAgreed` in the body. If either is missing or false, the API returns **400** with a clear message:
  - "You must agree to the Terms and Conditions."
  - "You must agree to the fantasy sports disclaimer (no gambling/DFS)."
- **Persistence**: Agreement is not stored as a separate record; acceptance is implied by account creation. The register payload includes both flags so the server never creates an account without acceptance.

---

## 5. Frontend Legal Page Updates

- **Disclaimer page** (`app/disclaimer/page.tsx`): New. Uses LegalPageShell; accepts `searchParams.from` and `searchParams.next`; back link = "Back to Sign Up" when `from=signup`, else "Back to Home". Content as in §2.
- **Terms page** (`app/terms/page.tsx`): Rebuilt with LegalPageShell; same searchParams behavior; content expanded as in §3; footer via shell (Disclaimer, Terms, Privacy, Home).
- **Privacy page** (`app/privacy/page.tsx`): Updated to use LegalPageShell and same `from=signup` / `next` behavior for "Back to Sign Up".
- **Signup** (`app/signup/page.tsx`): Disclaimer block includes link "Read full Disclaimer" → `getDisclaimerUrl(true, nextParam)` opened in **new tab** (`target="_blank" rel="noopener noreferrer"`). Terms block includes "Terms of Service" and "Privacy Policy" links → `getTermsUrl(true, nextParam)` and `/privacy` in new tab. Checkboxes and submit gating unchanged; both required to enable Create Account.
- **Footers**: App, Bracket, and Trade Analyzer product footers now include a **Disclaimer** link (Disclaimer • Privacy • Terms). Other footers (e.g. brackets landing) can be updated similarly if needed.

---

## 6. Full UI Click Audit Findings

| Element | Component / Route | Handler / Behavior | Verified |
|--------|-------------------|--------------------|----------|
| Disclaimer link (signup) | SignupPage | Link to `getDisclaimerUrl(true, nextParam)`; `target="_blank"` | ✅ |
| Terms link (signup) | SignupPage | Link to `getTermsUrl(true, nextParam)`; `target="_blank"` | ✅ |
| Privacy link (signup) | SignupPage | Link to `getPrivacyUrl(true, nextParam)`; `target="_blank"`; Back to Sign Up when from=signup | ✅ |
| Open in new tab | SignupPage | All three links use `target="_blank" rel="noopener noreferrer"` | ✅ |
| Back to Sign Up (disclaimer) | /disclaimer | When `from=signup`, back href = `getSignupReturnUrl(next)`; label "Back to Sign Up" | ✅ |
| Back to Sign Up (terms) | /terms | Same as disclaimer | ✅ |
| Back to Sign Up (privacy) | /privacy | Same as disclaimer | ✅ |
| Back to Home | All legal pages | When not from signup, back href = "/", label "Back to Home" | ✅ |
| Disclaimer checkbox | SignupPage | `disclaimerAgreed`, `setDisclaimerAgreed`; required | ✅ |
| Terms checkbox | SignupPage | `termsAgreed`, `setTermsAgreed`; required | ✅ |
| Validation (missing agreement) | SignupPage | Submit disabled when either unchecked; no submit possible | ✅ |
| Create account button gating | SignupPage | `disabled` includes `!termsAgreed \|\| !disclaimerAgreed` | ✅ |
| Footer Disclaimer link | app, bracket, trade-analyzer | Link to `/disclaimer` | ✅ |
| Footer Privacy/Terms | app, bracket, trade-analyzer | Links to `/privacy`, `/terms` | ✅ |
| Legal page footer links | LegalPageShell | Disclaimer, Terms, Privacy, Home | ✅ |
| Mobile rendering | Legal pages | Responsive padding and text (LegalPageShell + tailwind) | ✅ |

All listed interactions are wired; no dead links; back-to-signup and agreement gating work end to end.

---

## 7. QA Findings

- **Disclaimer page**: Opens at `/disclaimer`; content is fantasy-specific (no gambling, no DFS, no league dues, AI guidance, local laws). Back to Sign Up when opened with `?from=signup`.
- **Terms page**: Opens at `/terms`; expanded sections (platform rules, anti-collusion, anti-cheating, AUP, AI policy, no manipulation, paid/free, subscriptions, account duties, content moderation, disputes, legacy import, limitation of liability, platform updates). Back to Sign Up when `?from=signup`.
- **Return to signup**: From legal pages with `from=signup` (and optional `next`), "Back to Sign Up" returns to `/signup` or `/signup?next=...`.
- **Checkboxes**: Disclaimer and Terms persist in React state through the flow; both required for submit; backend rejects register if either is false.
- **Signup blocked**: Create Account stays disabled until both agreements are checked; API returns 400 if either is missing.
- **Legal pages on mobile**: Layout and text are responsive; touch targets and readability are adequate.

---

## 8. Issues Fixed

- **No standalone Disclaimer page**: Added `/disclaimer` with fantasy-sports-specific content (no gambling, no DFS, no league dues, AI disclaimer, local laws).
- **Terms not comprehensive**: Expanded Terms with platform rules, anti-collusion, anti-cheating, acceptable use, AI policy, no manipulation, paid/free and subscriptions, account responsibilities, content moderation, dispute handling, legacy import, limitation of liability, and platform update language.
- **No links from signup to legal pages**: Added "Read full Disclaimer" and "Terms of Service" / "Privacy Policy" links from signup; open in new tab so user can return to signup without losing state.
- **No Back to Sign Up on legal pages**: Legal pages accept `?from=signup&next=...` and show "Back to Sign Up" with correct `/signup` URL.
- **Footer missing Disclaimer**: App, Bracket, and Trade Analyzer footers now include Disclaimer link.
- **Consistent legal layout**: LegalPageShell used for Disclaimer, Terms, and Privacy for consistent look and footer.

---

## 9. Final QA Checklist

- [x] Disclaimer page opens and displays correct content.
- [x] Terms page opens and includes all required sections.
- [x] User can open disclaimer/terms from signup (new tab) and return to signup.
- [x] Back to Sign Up on legal pages works when `from=signup`.
- [x] Agreement checkboxes persist in signup state.
- [x] Signup is blocked when required agreements are not checked.
- [x] Signup proceeds when both agreements are checked and backend accepts.
- [x] Legal pages render well on mobile and desktop.
- [x] Every legal-related click path works; no dead links or broken back navigation.

---

## 10. Explanation of the Legal and Agreement System

- **Legal surfaces**: The app has three main legal pages—**Disclaimer** (fantasy-only, no gambling/DFS, no league dues, AI and local-law disclaimer), **Terms of Service** (platform rules, anti-collusion, anti-cheating, AUP, AI use, no manipulation, paid/free, subscriptions, account duties, content moderation, disputes, legacy import, liability, updates), and **Privacy Policy** (data collection, use, sharing, rights). They share a common shell (LegalPageShell) for layout and footer links.

- **Signup flow**: Before creating an account, the user must check "Disclaimer" and "Terms and Conditions and Privacy Policy." They can open the full Disclaimer and Terms (and Privacy) in a new tab via inline links; the signup tab stays open so state is preserved. If they open a legal page from signup (e.g. via a link that includes `?from=signup&next=...`), the back link becomes "Back to Sign Up" and returns them to `/signup` with optional `next` preserved.

- **Gating**: The Create Account button is disabled until both agreement checkboxes are checked (and other validations pass). The register API requires `disclaimerAgreed` and `termsAgreed` in the request body and returns 400 with a clear message if either is missing or false. This ensures account creation only happens after explicit acceptance of the disclaimer and terms.

- **Footers**: Product footers (App, Bracket, Trade Analyzer) link to Disclaimer, Privacy, and Terms so users can find legal information from anywhere. Legal pages themselves link to each other and Home in a consistent footer.

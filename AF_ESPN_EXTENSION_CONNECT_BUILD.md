# AF ESPN One-Click Connect (Browser Extension) — Build Brief

**Status:** ready to build · **Prepared:** Jul 16, 2026 · **For:** Claude Code
**Goal:** Let a non-technical user connect their private ESPN league in **one click** — no DevTools, no copy-paste. The AllFantasy browser extension reads the user's ESPN session cookies (`SWID` + `espn_s2`) and saves them to their AllFantasy account via the existing encrypted API. This removes the single biggest onboarding wall.

**Read alongside:** the ESPN import fix (`components/settings/EspnCookieConnection.tsx` + `app/api/league/auth/route.ts` — the encrypted save/list/delete API already exists and works), brand rules (no "AI" customer-facing).

**Why this is small:** the hard parts are done. Encrypted per-user cookie storage (`LeagueAuth`), the save endpoint, and the whole preview→commit pipeline that reads `getDecryptedAuth(userId,'espn')` already exist. The manual paste form already calls the API. **This brief only adds the one-click capture path in front of that same endpoint.**

---

## 0. Audit first
- **Locate the existing AllFantasy browser extension.** It's referenced in the stack (integration health matrix). If it lives in this repo, extend it; if it's a **separate repo**, the extension code goes there and only the web-app button + any endpoint/CORS change land in this repo — note which and hand back the extension-repo diff separately.
- **Confirm the save endpoint contract:** read `app/api/league/auth/route.ts` — exact POST shape for saving an ESPN credential (platform `espn`, the SWID/espn_s2 fields), and how it authenticates the user (session cookie? token?). The extension must satisfy that same auth + CSRF.

## 1. The flow (what the user experiences)
1. User installs the AllFantasy extension (one-time) and is logged into AllFantasy.
2. User is logged into ESPN normally (fantasy.espn.com) in the same browser.
3. In AllFantasy **Settings → Connected Accounts → ESPN**, a **"Connect with 1 click"** button appears when the extension is detected.
4. Click → extension reads the two ESPN cookies → POSTs them to `/api/league/auth` as the logged-in user → UI flips to "ESPN connected." Done. No DevTools.
5. Manual paste form (`EspnCookieConnection.tsx`) stays as the fallback when the extension isn't installed.

## 2. Extension (Manifest V3)
- **Permissions — minimal:** `"cookies"` + host permission for `*://*.espn.com/*` only (to read SWID/espn_s2). Host permission for the AllFantasy origin to POST. **No broad `<all_urls>`.**
- **Read cookies:** `chrome.cookies.get({ url: "https://fantasy.espn.com", name: "SWID" })` and `... name: "espn_s2"`. Handle the `.espn.com` domain variants.
- **If a cookie is missing** (user not logged into ESPN): return a clear "Log into ESPN first" state, never a silent failure.
- **Trigger from the web app (preferred, most seamless):** add `"externally_connectable": { "matches": ["https://*.allfantasy.ai/*"] }` so the Settings page can call `chrome.runtime.sendMessage(EXTENSION_ID, {type:'connectEspn'})`; the extension grabs cookies, POSTs, and replies success/failure. Provide an **extension popup button** ("Connect my ESPN to AllFantasy") as the fallback trigger.
- **Send securely:** `fetch(ALLFANTASY_API + '/api/league/auth', { method:'POST', credentials:'include', body: {platform:'espn', swid, espnS2} })` over HTTPS only. Match the endpoint's auth + any CSRF token requirement (may need the endpoint to accept the extension's request — see §3).

## 3. Backend (small, may be zero)
- Verify `/api/league/auth` POST accepts the extension's authenticated request. If CSRF/same-origin checks block a `credentials:'include'` call from the extension, add a **narrow, safe path**: accept the request when it carries the user's valid AllFantasy session AND originates from the known extension ID (allowlist the extension origin) — do NOT weaken CSRF globally. Alternative if cleaner: a short-lived one-time "extension pairing token" minted by the web app that the extension exchanges. Pick the simpler secure option after reading the endpoint.
- No schema changes — reuse `LeagueAuth` + the existing encrypt-at-rest path.

## 4. Build checklist (all seven)
1. **Visual** — the "Connect with 1 click" button + detected/not-detected/connected/error states in `EspnCookieConnection.tsx`; extension popup UI.
2. **Backend** — endpoint auth/CSRF reconciliation for the extension origin (only if needed).
3. **UI/UX** — extension-detected → one click; not-installed → install CTA + manual fallback; not-logged-into-ESPN → clear prompt; success confirmation.
4. **Delete old** — none (net-new path); don't disturb the working manual form.
5. **Fixes/gaps** — handle cookie-missing, expired-cookie, and extension-absent gracefully.
6. **SEO/ASO** — n/a (authed); the Chrome Web Store listing copy for the extension must follow brand rules (no "AI").
7. **On-brand** — no "AI" anywhere in the extension or button copy; clear consent language ("we read only your ESPN league cookies, encrypted, to import your leagues").

## 5. Security & privacy (non-negotiable — these are session credentials)
- HTTPS only; never log cookie values anywhere (extension or server).
- Minimal permissions (espn.com cookies + AllFantasy origin only).
- Encrypted at rest (backend already does this).
- Explicit user consent copy on the button + extension: exactly what's read and why.
- Ties to W1 (legal/ToS): reading ESPN cookies with the user's own logged-in session is the standard third-party pattern, but keep the consent explicit.

## 6. Acceptance criteria
- [ ] With the extension installed + user logged into ESPN and AllFantasy, clicking "Connect with 1 click" saves valid SWID + espn_s2 to the account (encrypted) with **no DevTools** — verified by a successful private-league import right after.
- [ ] Extension requests only espn.com cookie access + the AllFantasy origin — no broad permissions.
- [ ] Not-logged-into-ESPN, missing-cookie, and extension-absent all show clear states; manual paste fallback still works.
- [ ] No cookie values are logged anywhere; transport is HTTPS-only.
- [ ] No "AI" in extension or button copy.

## 7. Verification
- Extension: load unpacked in Chrome, log into ESPN, click connect → confirm the two cookies POST and the account shows ESPN connected → run a real private-league import.
- Web app: `npm run build` + `npm run typecheck` (ratchet clean); tests for the endpoint accepting the extension-origin request and rejecting an unauthenticated one.
- Manual QA on the not-installed / not-logged-in paths.

## 8. Follow-ups
- **Mobile:** extensions don't work on most mobile browsers — ESPN-private on mobile stays hard industry-wide. Guide mobile users to connect once on desktop (it's saved after). Out of scope here; note it in the UI.
- **Generalize later:** the same extension message protocol could capture other cookie-based platforms if any arise (Yahoo=OAuth and MFL=API key don't need it; ESPN is the main case).

*Sequence: audit endpoint + locate extension → extension cookie-read + externally_connectable trigger → wire the Settings button + states → reconcile endpoint auth for the extension origin → security pass → test end-to-end with a real ESPN login.*

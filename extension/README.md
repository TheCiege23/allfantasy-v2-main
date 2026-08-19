# AllFantasy — Connect ESPN (browser extension)

One-click ESPN private-league connect. Reads the user's own `SWID` + `espn_s2` cookies from
`*.espn.com` and saves them, encrypted, to their AllFantasy account via the existing
`POST /api/league/auth` endpoint — the same encrypted storage the manual paste form
(`components/settings/EspnCookieConnection.tsx`) already uses. No new backend storage.

**Audit note:** no pre-existing AllFantasy browser extension was found anywhere — not in this
repo, not in a sibling directory, not referenced in `docs/`, not in this project's saved
memory. This is a net-new extension, built here rather than in a separate repo since none
exists yet to extend. If the team wants it split into its own repo before publishing, this
folder is self-contained and can be moved as-is.

## What it does

1. User installs the extension and is signed into AllFantasy and logged into ESPN in the same
   browser.
2. AllFantasy's Settings → Connected Accounts → ESPN shows a **"Connect with 1 click"** button
   once it detects the extension.
3. Click → the extension's background service worker reads `SWID` and `espn_s2` for
   `fantasy.espn.com` (falling back to the `.espn.com` domain variants) and POSTs them to
   `/api/league/auth` with `credentials: 'include'` — the same request the manual form makes.
4. AllFantasy flips to "ESPN connected." Private ESPN leagues can now be previewed/imported.

The manual paste form stays as the always-available fallback when the extension isn't
installed, the user is on a browser without extension support, or something goes wrong.

## Permissions (minimal, by design)

| Permission | Why |
|---|---|
| `cookies` | Read `SWID` / `espn_s2` — nothing else. |
| `host_permissions: *://*.espn.com/*` | Only host allowed to read cookies from. |
| `host_permissions: https://(www.)allfantasy.ai/*` | Only host the extension ever sends a request to. |

No `<all_urls>`. No content scripts. No access to any other site's cookies or page content.

## Required configuration before publishing

Two env vars carry the same Chrome-assigned extension ID into two different runtime contexts
(Next.js requires the `NEXT_PUBLIC_` prefix for anything read in the browser bundle):

- **`ESPN_EXTENSION_ID`** (server, no `NEXT_PUBLIC_` prefix) — used by
  `app/api/league/auth/route.ts`'s origin check to recognize a request as
  `chrome-extension://<this id>`. Until this is set, no `chrome-extension://` origin is
  trusted (fail-closed default — see `lib/extension/allowedRequestOrigin.ts`).
- **`NEXT_PUBLIC_ESPN_EXTENSION_ID`** (client) — used by
  `components/settings/EspnCookieConnection.tsx` to address
  `chrome.runtime.sendMessage(EXTENSION_ID, ...)`. Until this is set, the Settings page always
  shows the "extension not installed" state and only the manual form is offered.

Both should be set to the **same** value: the extension's real ID (a stable ID appears once
you either (a) load it unpacked with a `"key"` field pinned in `manifest.json`, or (b) publish
it to the Chrome Web Store, which assigns a permanent ID).

## Local testing (manual — requires a real Chrome + a real ESPN login)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this
   `extension/` folder.
2. Copy the extension ID Chrome assigns and set both env vars above to it (for local dev,
   point `ESPN_EXTENSION_ID`/`NEXT_PUBLIC_ESPN_EXTENSION_ID` at that dev-loaded ID; a
   dev-loaded ID is stable across reloads of the same unpacked folder on the same machine,
   but will differ on another machine/profile).
3. Log into `fantasy.espn.com` in the same Chrome profile.
4. Open the AllFantasy Settings → Connected Accounts page and click **"Connect with 1 click"**
   (or open the extension's own popup and click its button as the fallback trigger).
5. Confirm the account shows "ESPN connected," then run a real private-league import.

This step — a real Chrome instance with the extension loaded and a genuine ESPN session — is
outside what this environment's tools can execute; the code above has been built and unit
tested against the same contract, but this manual pass is the team's to run.

## Security

- Cookie values are **never logged** — not in the extension, not on the server (confirmed:
  `background.js` only ever returns a boolean `ok` + a short error `code`/`message`; the
  server route logs generic errors only, never the credential fields).
- HTTPS only (`host_permissions` only lists `https://` origins for AllFantasy; ESPN's own
  cookies are also HTTPS-only in practice).
- Encrypted at rest — unchanged; reuses `lib/league-auth-crypto.ts` + the `LeagueAuth` table.

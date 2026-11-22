# ESPN import guide — screenshot slots

The ESPN steps in `components/core-app/import/ImportGuide.tsx` have screenshot slots. Drop a PNG at
each path below and it appears in the guide on the next deploy. Nothing else needs to change.

Until a file exists, the slot shows **nothing in production** and a dashed, labelled placeholder in
development (`next dev`), so you can see where each picture goes.

| File (under `public/`) | Shown at | What it should show |
|---|---|---|
| `import-guides/espn/01-league-id-in-address-bar.png` | Step 1 — paste your league ID | An ESPN fantasy football league page, with the `leagueId=` number highlighted in the address bar |
| `import-guides/espn/02-chrome-devtools-application-cookies.png` | Step 3 — Chrome / Edge tab | DevTools → **Application** → **Cookies** → `https://fantasy.espn.com`, with the `SWID` and `espn_s2` rows highlighted |
| `import-guides/espn/02-safari-web-inspector-storage-cookies.png` | Step 3 — Safari tab | Web Inspector → **Storage** → **Cookies** → `fantasy.espn.com`, same two rows highlighted |
| `import-guides/espn/02-firefox-devtools-storage-cookies.png` | Step 3 — Firefox tab | DevTools → **Storage** → **Cookies** → `https://fantasy.espn.com`, same two rows highlighted |
| `import-guides/espn/03-paste-cookies-into-allfantasy.png` | Step 4 — paste and save | The AllFantasy ESPN cookie form with both boxes filled |

## Before you commit a screenshot

🛑 **Blur or crop the cookie VALUES.** `SWID` and `espn_s2` are a logged-in ESPN session — a
screenshot that shows them hands that ESPN account to anyone who opens the image, and this repo is
public. Show the cookie NAMES and the Value column, with the values blurred.

- PNG, about 1200px wide; the guide scales it to the column width.
- Use a throwaway or demo ESPN league. No real league names or manager names.
- The alt text lives with the slot in `ImportGuide.tsx`; update it if the picture changes.

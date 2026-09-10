# Mobile GUI continuation — league tray and Standings

Continues draft PR #691 on `audit/mobile-p0-foundation`, starting at
`f2a241a9e2b67ff63e51db65317722aff9dd97ac`. Main was
`1a43ebbd8d338a59d297a0ec46fc3f8a0ec2a3a8`. The uploaded `final19a.txt`
reports 95 passing tests without test names; it cannot certify mobile journeys.

## Repairs

- The phone league tray now contains keyboard focus, makes background shell
  controls inert, locks background scrolling, closes on Escape, and restores
  focus. Home, add-league, and settings links close it as league links do.
- Phone tray state is temporary. A saved expanded desktop rail no longer opens
  the overlay on a phone page load. Crossing the breakpoint closes the phone
  tray and restores the saved desktop preference when returning to desktop.
- The tray reserves space for its Close control and device safe area. Browser
  measurement exposed a desktop selector overriding the phone padding; the
  phone selector now has enough specificity. League and utility targets have
  a 44px minimum height.
- Bottom navigation labels increased from 9.5px to 11px and can wrap. The
  league handle label also increased to 11px.
- Current and historical Standings tables have named, keyboard-focusable scroll
  regions and visible scroll instructions. Team identity remains visible while
  scrolling on phones. Historical team cells now identify row headers.

## Verification

- Vitest: **73 passed across 4 files** — `core-rail-default-open`,
  `core-rail-active-league`, `mobile-navigation-drawer`, and `core-boards`.
- Changed TS/TSX ESLint: no errors; existing `AfCoreShell` image warning remains.
- CSS syntax guard: all 82 stylesheets parsed successfully.
- Chromium 152 component browser proof passed at **320, 360, 390, 430 × 844**:
  no document overflow; 11px labels without horizontal clipping; handle clears
  the bottom bar; both tables scroll while retaining team identity; focus cycles
  within the tray; background becomes inert; final league clears Close; Escape
  restores focus and background interaction.
- Phone → 1280px desktop → 320px phone transition passed: focus moves to the
  visible desktop toggle, background interaction returns, and the phone tray
  stays closed when returning to the phone layout. 320px screenshots were
  visually inspected.

Reproduce the component proof after `npm ci` and installing Playwright Chromium:

```sh
node scripts/audits/mobile-core-browser-proof.cjs
```

The script builds the **real AfCoreShell and Standings components and CSS** with
20 fixture leagues and 12 standings rows. It stubs Next navigation and unrelated
service-backed children, including CommsDock, player-card context, sync controls,
and alerts. It uses fallback fonts instead of Next's loaded font assets.
It starts an ephemeral local server and writes screenshots to a temporary path
reported at completion. It does not access a database or external fantasy host.
`AF_BROWSER_EXECUTABLE` can select an installed Chromium binary. This run used a
temporary Chromium distribution because the normal Playwright browser download
timed out; no browser package was added to the app dependencies.

## Remaining journey ledger

| Surface | Status | Remaining verification |
| --- | --- | --- |
| Global landing/header/drawer | P0 code in draft | Run original landing and authenticated navigation specs, including WebKit. |
| Core league selection and bottom navigation | Component proof passed | Authenticated navigation, live data, actual fonts, safe-area device, and CommsDock interaction. |
| Standings current and past seasons | Component proof passed | Authenticated data/loading/error states and WebKit. |
| Dashboard and league home | Pending content audit | Four-width journey checks. |
| My Team, Trade Center, Waivers | Pending content audit | Four-width journey checks and action sheets. |
| Chimmy | Pending content audit | Keyboard-open composer, dialogs, and drawer overlap. |
| Specialist screens and themes | Pending | P2 queue in the P0 audit; contrast and text zoom remain unverified. |

No authenticated E2E run, WebKit run, full typecheck, or production deployment
was performed in this continuation. The draft remains unready for merge until
the P0 browser gates and authenticated journey checks are satisfied.

# Mobile GUI P0 audit — 2026-09-10

## Scope

This pass covers the public landing page and the two shared navigation systems
that frame most authenticated screens. Target phone widths are 320–430px.
Route-specific redesigns are deliberately separated into the follow-up queue so
the shared fixes can land without changing fantasy calculations or feature
behavior.

## P0 findings and disposition

| Finding | User impact | Disposition |
| --- | --- | --- |
| The landing header promoted desktop controls into roughly three phone rows. | A large portion of the first viewport was navigation instead of the product promise. | Fixed: one 64px row, persistent primary CTA, native secondary menu. |
| Mobile coverage used one 390px viewport. The default Playwright mobile projects are disabled. | 320px and 360px regressions could ship while the existing check stayed green. | Fixed for the landing contract: 320, 360, 390, and 430px matrix. The authenticated drawer check now starts at 320px. |
| The authenticated global header showed a full utilities row and a product-group row in addition to the brand row. | Excessive chrome and cramped/wrapping controls before app content. | Fixed: authenticated phone header is one row; utilities remain reachable in the drawer and primary destinations remain in the bottom bar. |
| Global menu open/close controls were 36×36px. Drawer links had no explicit 44px floor. | Missed taps, especially one-handed and for users with motor impairments. | Fixed: 44px controls/rows, 48px bottom destinations. |
| The global drawer was a modal dialog without initial focus, a focus trap, or focus return. | Keyboard and assistive-technology users could move behind the drawer or lose their place on close. | Fixed: initial close-button focus, Tab containment, Escape close, and opener focus restoration. |
| Drawer height/padding did not explicitly account for dynamic viewport and device safe areas. | Browser chrome and notches could crowd or obscure controls. | Fixed: `100dvh`, safe-area-aware header/footer padding, contained overscroll. |
| The `/core` league tray handle claimed a 44px target but was 26px wide and sat vertically over content. | The only phone entry to a user's imported leagues was difficult to hit and reduced readable content width. | Fixed: horizontal 44px+ state-labelled pill above the phone tab bar; removed the permanent left content indent. |

## Regression contracts added

- Landing page has no document-level horizontal overflow at 320, 360, 390, or 430px.
- Landing mobile header remains one row and its CTA/menu targets are at least 44px.
- Landing secondary navigation opens and exposes sign-in.
- Authenticated header remains below 80px at 320px and does not create body overflow.
- Mobile drawer close target is at least 44×44px.
- Drawer focuses its close control, closes on Escape, and restores the opener.
- `/core` league control exposes the correct stateful accessible name.

## Validation

- Focused Vitest: 2 files, 9 tests passed.
- ESLint on every changed TS/TSX file: 0 errors; one pre-existing `no-img-element` warning in `AfCoreShell.tsx`.
- CSS syntax guard: all 82 stylesheets parsed cleanly.
- Playwright collection: the three affected desktop/mobile tests collect cleanly.
- Full repository typecheck is not a usable green gate on this checkout: it is already red across unrelated World Cup, tournament, Prisma JSON, and other active feature files. No reported error targeted this batch's files.

The local environment did not have the matching Playwright browser binary, so
the new browser assertions were collected but not executed here. They should be
run in the repository's normal CI/staging browser environment before merge.

## Follow-up GUI queue

### P1 — core user journeys

1. Audit authenticated route content at all four widths: dashboard, league home,
   My Team, Trade Center, Waivers, Standings, and Chimmy.
2. Replace dense phone tables with summary cards where comparison across columns
   is not essential. Keep intentional horizontal tables inside labelled scroll
   regions and add sticky identity columns plus a visible scroll cue.
3. Standardize dialogs and sheets: 44px close controls, focus containment,
   keyboard-safe height, `100dvh`, and safe-area padding.
4. Raise essential labels below 11px and verify contrast in every supported
   theme; the `/core` tab bar still uses 9.5px labels.
5. Verify form inputs at 16px on iOS to prevent focus zoom, and keep submit/error
   states visible above the software keyboard.

### P2 — high-density specialist surfaces

- Commissioner Hub and commissioner analytics.
- Draft rooms, brackets, tournament, devy/C2C, salary-cap, and IDP data tables.
- Landscape phones, installed-PWA mode, reduced motion, 200% text zoom, and
  screen-reader route announcements.

## Recommended merge gate

Run the two affected Playwright specs in Chromium, then repeat the 320px drawer
and landing cases in WebKit. Treat document-level overflow, hidden primary
actions, fixed-control overlap at the page end, or any sub-44px primary control
as merge blockers.

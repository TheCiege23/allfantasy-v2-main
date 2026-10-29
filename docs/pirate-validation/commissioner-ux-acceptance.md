# Commissioner settings and sign-in prompts — 2026-10-29

## Physical Android findings

The owner confirmed that the Android sign-in alert flow and test notification worked. They could not find Pirate rules in the commissioner workspace and reported that the welcome guide was pushed out of view except for its close icon. The commissioner rules save/reload check on that physical device is still pending the revised UI deployment. The earlier physical iPhone Home Screen push test passed.

## Changes

- Native league Commissioner and Settings entries open the same authorized settings editors. The Core commissioner entry also opens these editors after its existing access check. League activity and reports remain reachable through a separately labeled link.
- Desktop has a category sidebar and focused editor. Mobile has a labeled category picker plus a dedicated Pirate rules shortcut. League, Roster, Scoring, Draft and Playoff settings use those precise names. Setup guidance and additional commissioner tools are collapsed below the editor.
- The category layout measures available space inside the league chrome. A constrained 820 px tablet initially left a 35 px input; container-based switching keeps the editor usable when the league sidebars occupy part of the screen.
- Pirate rules joins the existing Save bar and unsaved-change confirmation. Edits are not sent until Save; rejected saves retain the edits and show the server error. The editor explains protections, winner selection, automatic claim settlement, overflow deadlines and playoff steals.
- General settings suppresses its old Auto-save badge inside the shared manual Save page. The older autosaving modal keeps its existing label.
- The welcome guide waits for the sign-in alert prompt to close. Its card cannot shrink in the shell's flex layout, has a labeled Close guide action, and moves into view after the alert flow. The alert sheet fits the dynamic viewport, scrolls internally when needed, and keeps keyboard focus within its actions with Escape support.

## Verification and limits

Actual React commissioner, Pirate editor, welcome and sign-in alert components passed browser emulation at Pixel 7 Chromium (412 px), iPhone 13 WebKit (390 px), and desktop Chromium (1365 px). Each saved protections as 2 through a mocked isolated API, reloaded the persisted value, then restored 3. No horizontal overflow occurred; close and Save controls measured 44 px or more. Welcome card heights were 205.95 px on phones and 194.72 px on desktop rather than a collapsed close icon. Session, permission adapters and the rules API were mocked for these rendering checks; they do not replace physical-device acceptance or a live authenticated commissioner save.

Constrained browser checks reserve the actual space taken by the surrounding league chrome. At an 820 px viewport with 512 px available, the input increased from 35 to 170 px and the category picker replaced the sidebar. At 1024 px with 716 px available it measured 272 px; at 1365 px with 965 px available the desktop sidebar remained and the input measured 261.5 px. All three had no document overflow. The phone/WebKit and desktop save/reload checks passed again after this correction.

The focused tests cover the real editor's shared Save integration, server rejection, unsaved-change cancellation/discard, explicit Pirate deep links, and prompt sequencing. Staging deployment and its exact commit must be verified separately. No production deployment or migration is authorized by this document.

The main UI commit `6b5c89cba8f426de1e9e09e01232ccc3bcf3fd5b` became healthy on isolated Railway staging at 13:07 UTC. A real authenticated Pixel 7 Chromium browser check passed at 13:13 UTC using a disposable synthetic account and seasonless league: normal credentials sign-in, deferral of the account's age prompt through Not now, Pirate rules discovery, save 2, reload 2, restore 3, no page errors and no horizontal overflow (412/412 px; input 292 px). The temporary league, tenant and account were removed. This verifies the deployed mobile editor and seasonless API; the tablet-width and save-label follow-up deployment and physical-device acceptance remain separate checks.

## Owner acceptance after deployment

1. On Android Chrome, reopen the PVT test league and choose Commissioner. Confirm Pirate rules is visible by name.
2. Open Pirate rules, change Protected players to 2, tap Save changes, reload, confirm 2, then restore and save 3.
3. On a first-visit browser profile, finish or dismiss the alert prompt. Confirm the welcome guide body and Close guide action are readable. Do not reset the owner's notification permission just to reproduce first-visit onboarding.

The remaining real-game acceptance gates are unchanged: immutable before/after lock observations, a real late status change where available, final weekly result/claim creation and a real 24-hour settlement. Keep unknown evidence review-only. Production requires reviewed green CI and separate release sign-off.

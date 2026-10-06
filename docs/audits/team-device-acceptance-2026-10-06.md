# Team workspace device acceptance

Status: authenticated local emulation will be recorded separately. Physical devices and signed-in production must be verified by the owner; this environment cannot control those devices or the existing production browser.

Use your own account and a league you own. Do not enable AutoSubs or change an active production lineup just to test. Private plans are drafts; notification tests should go only to your own opted-in address or device.

## Checks available on the current production release

Run on a physical iPhone, Android phone, and tablet if available. Record device, OS, browser, date/time and PASS/FAIL/UNAVAILABLE for each check.

1. Open https://www.allfantasy.ai/core/live and https://www.allfantasy.ai/core?league with a selected league. Sign in and confirm the original destination and league survive login, refresh and browser Back.
2. Open My Team. Confirm player names, score tiles and action buttons remain readable without horizontal page scrolling. Rotate portrait/landscape. On tablet, test both landscape and split view.
3. Open the future-week planner. Choose a future week and save a private note such as `Device acceptance`. Open that same league/week on another device; confirm the note appears after reload. Confirm neither device submitted a lineup.
4. On device A, leave the planner open and edit the note without saving. On B, save a different note. Save on A: expect a conflict, with A's edits still visible. Explicitly reload the saved plan and confirm B's version appears. Remove the test note after acceptance.
5. Open the keyboard on notes and dismiss it. Check that Save, Reload and the bottom navigation remain reachable, including near an iPhone notch/home indicator. Confirm focus remains visible and labels can be read at increased text size.
6. For installed web apps: add AllFantasy to the Home Screen, open from its icon and repeat navigation/keyboard checks. Push permission on iOS/iPadOS must be requested from the installed Home Screen web app in response to a user action; use the existing notification settings controls, not a browser prompt on page load.

## Checks after the delivery/preview release is deployed

7. Open My Team > Native AutoSubs > Reload settings. Expect an off, paused, waiting or eligible explanation with the time checked. Reading this preview must not submit a lineup. For an existing paused assignment, confirm the reason says the lineup changed and explains reviewing/saving again; do not create a production lineup change for the test.
8. Open league injury/deadline alerts. Confirm Recent notification delivery is scoped to your account and league, and reports only actual recorded attempts. With notifications disabled, expect suppression, not a delivery claim. Old attempts without receipts remain unconfirmed.
9. If you already use push on your own installed device, use the existing Send test control in notification settings. Verify foreground/background behavior, tap-through to the league, and reopening the app after dismissal. Report provider acceptance separately from what you actually saw. Do not send test messages to league members.
10. Observe the next naturally generated team alert in the receipt history: email `Provider accepted` may later become recipient-server delivery; SMS may become carrier-reported delivery. Push endpoint acceptance never proves display or reading. Failed/suppressed attempts are not automatically resent.

## Result format

`Device / OS / browser / installed web app yes-no: navigation PASS; layout PASS; keyboard PASS; shared plan PASS; conflict PASS; preview PASS-FAIL-UNAVAILABLE; receipt PASS-FAIL-UNAVAILABLE; actual push PASS-FAIL-UNAVAILABLE. Details: ...`

Leave missing devices or accounts UNAVAILABLE; emulation is not physical acceptance. No credentials, cookies or API tokens belong in the results.

References: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ and https://resend.com/docs/api-reference/emails/retrieve-email.

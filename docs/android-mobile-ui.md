# Android mobile UI pass

The shared AF Core shell now uses larger bottom-navigation glyphs and touch controls, clearer labels, and consistent phone gutters. The top-bar status row can scroll independently on narrow phones. The app-wide Button, Input, Select and Dialog components use 48px phone touch targets. Tall dialogs scroll inside the visible screen, including when the Android keyboard reduces the visual viewport. Zoom remains enabled; pinch zoom does not trigger the keyboard treatment.

The viewport provider is mounted once for all routes. It hides competing navigation and floating chat controls only while an editable field is focused and the visible height falls by more than 150px; toolbar movement alone does not hide controls. Existing communications viewport handling is preserved. Desktop control density is unchanged apart from the larger dialog close target and clearer dialog spacing.

## Verification

- Keyboard detection, toolbar movement, pinch zoom, unsupported browsers, and listener cleanup: covered by phone-viewport tests.
- Existing shared menu focus containment and mobile drawer behavior: tested.
- Non-production `/e2e/android-mobile` harness uses real shared form/dialog components and requires PLAYWRIGHT_E2E=1. It contains no real league data and is unavailable in production.
- 18 focused unit tests passed across viewport behavior, shared menu focus containment, mobile drawer behavior and shell language helpers.
- Chrome browser checks at 360x800 and 412x800: no horizontal overflow in the shared-control harness. Buttons, inputs and dropdown choices have 48px computed minimum heights. The tall dialog scrolls to its final action and Escape restores focus to its opener.
- The Playwright regression spec is included for CI; the local browser checks used Chrome directly.
- Physical Android keyboard behavior and all authenticated specialized screens still require verification; a shared-control test is not certification of every screen. This is a shared UI foundation pass, not a complete screen-by-screen redesign.

## Reference

- Android touch targets: https://developer.android.com/guide/topics/ui/accessibility/views/apps-views
- Chrome keyboard viewport behavior: https://developer.chrome.com/blog/viewport-resize-behavior

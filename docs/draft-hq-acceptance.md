# Draft HQ acceptance evidence

The latest server release must be checked at `/core/draft-hq` and `/core/draft-hq?league`. Public HTTP success is guest availability only. Fixture browser checks use synthetic data and an isolated browser without user cookies.

| Check | Evidence/state |
| --- | --- |
| Archive permission enforcement and selected-league tool dispatch | Covered by regression tests and permission-checked read probes |
| EN/ES help hover, click/tap, focus and Escape; small-screen overflow | Chromium fixtures at 320, 390, 768 and 1440 CSS pixels |
| Weekly paging, negative points, missing rows, roster departure | Component and evidence regressions |
| Finalized bench substitution and partial finalization | Component/model regressions; production values require real reconciled evidence |
| Actual signed-in league switching and archive selection | Unverified: desktop browser helper fails at startup |
| Sending a selected archive question and receiving a live Chimmy explanation | Unverified: authenticated browser access unavailable; no synthetic provider response claimed |
| Safari on physical iPhone/iPad | Unverified: physical device access unavailable |
| Chrome on physical Android phone/tablet | Unverified: physical device access unavailable |

When live access works: select an owned league, open each Draft HQ URL, inspect a historical archive, switch leagues and confirm the previous league's facts do not remain. Open Chimmy from the selected archive, review/send the prefilled question, and verify the response states provisional/final coverage, dates and missing evidence correctly. Repeat for a non-member league and confirm access is denied. Do not obtain cookies or credentials through shell commands.

On real devices: test portrait/landscape, table scrolling without page overflow, tabs, selection/search, native help touch pinning and dismissal, keyboard focus, replay controls, weekly/replacement paging and the Chimmy composer. Record device model, OS/browser version, language, URL and defects. Do not mark these rows passed based on desktop viewport emulation.

# Draft room — real device QA checklist (Phase 5I)

Use this for **closed alpha** sign-off on **live drafts**. Record pass/fail and notes per device.

**Devices / widths**

| Target | Viewport / browser | Tester / date | Result |
|--------|--------------------|---------------|--------|
| iPhone Safari | ~390×844 portrait | | |
| Android Chrome | ~360×800 portrait | | |
| Mobile landscape | ~844×390 (or 780×360) | | |
| Desktop Chrome | ≥1280×800 | | |
| Desktop Firefox | ≥1280×800 | | |

**Agent / CI pass (2026-05-13):** Code review + layout/CSS/a11y fixes only; **not** a substitute for physical devices — complete the table above on real hardware.

---

## 1. Timer visibility

- [ ] Pick timer (or “—” / Paused) readable in **desktop** top bar.
- [ ] **Mobile sticky bar** shows clock + current pick on **Board**, **Players**, **Queue**, **Chat**, **Roster**, **AI helper** tabs.
- [ ] **Stale snapshot** banner (amber) readable; **Resync** tappable.
- [ ] **Sync issue** chip readable when connection is degraded (simulate flaky network).
- [ ] **Refreshing…** chip appears while manual resync is in flight.

## 2. Pick flow

- [ ] Primary **Draft** control reachable (thumb zone) on narrow portrait.
- [ ] While submitting: **Submitting pick…** banner visible; pool **Draft** buttons disabled / show submitting state.
- [ ] Success: **Pick locked in** banner appears; pool re-enables.
- [ ] Failure: friendly message (stale overall / race / not on clock); **Resync** if suggested.
- [ ] Rapid double-tap on **Draft** does not create two picks (server + client guard).

## 3. Queue flow

- [ ] Add player to queue from row / table.
- [ ] Remove or reorder (if enabled) without layout break on small screens.
- [ ] Queue panel does **not** cover mobile **Draft** CTA (scroll if needed).
- [ ] Refresh page: queue restores for the signed-in user.

## 4. Commissioner controls

- [ ] **Pause / Resume** reachable from top bar menu (mobile + desktop).
- [ ] **Undo pick** / **Reset timer** (if shown): confirm dialogs work; success/error banner visible.
- [ ] Commissioner menu / modal not clipped by notch or home indicator (`safe-area`).

## 5. Chat + draft layout

- [ ] **Chat** tab: composer does not permanently hide primary actions; scroll content if needed.
- [ ] **Keyboard** (mobile): focus in chat search/composer still allows reaching **Board** / **Players** via tab bar.
- [ ] **Mobile tabs** (Board / Players + secondary dock): switch without stuck state.

## 6. Reconnect / resync

- [ ] Airplane mode ON ~15s: **Sync issue** (or equivalent) appears when poll streak degrades.
- [ ] Airplane mode OFF: polls recover; chip clears after success.
- [ ] **Resync** from menu: **Refreshing…** shows; timer/board update.
- [ ] Stale snapshot warning clears after successful sync (or fresh `updatedAt`).

## 7. Big screen (`/draft/...` big screen route)

- [ ] No horizontal page scroll; board scrolls inside its region if wide.
- [ ] Timer visible (stacked under title on narrow height).
- [ ] Long league name wraps; grid readable.

## 8. Accessibility (quick)

- [ ] **Resync** (menu) has an accessible name; busy state exposed while refreshing.
- [ ] **Draft** disabled state not focus-styled as active; focus ring visible on Tab navigation.
- [ ] Tab bar buttons have **aria-pressed** / labels (shell).

---

## Sign-off

- [ ] All **blockers** on target devices resolved or ticketed.
- [ ] **Closed alpha** go / no-go: _________________

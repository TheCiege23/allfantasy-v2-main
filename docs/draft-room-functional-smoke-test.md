# Draft Room Functional Smoke Test

Manual test checklist for the live draft room. Run against a real league with an active or pre-draft session. Each step should be verified in the browser before marking complete.

---

## 1. Resume Paused Draft

**Setup:** Draft is in `paused` state (timer stopped, picks disabled).

- [ ] Navigate to the draft room URL.
- [ ] Confirm the room loads without a full-page spinner (room shell appears while player pool loads independently).
- [ ] Confirm the timer/clock shows "Paused" or is absent.
- [ ] Commissioner clicks **Resume** in the control panel.
- [ ] Timer restarts and the current pick slot becomes active.
- [ ] Non-commissioner users see the timer running without any page refresh.

---

## 2. Make Manual Pick from Player Pool

**Setup:** It is the current user's turn to pick (on the clock).

- [ ] Player pool is visible and populated (at least one player row shown).
- [ ] Click a player row — player detail modal or pick confirmation appears.
- [ ] Click **Draft** in the confirmation.
- [ ] Network request to `POST /api/leagues/[leagueId]/draft/pick` returns 200.
- [ ] The picked player disappears from the pool (or shows "Drafted" badge).
- [ ] Pick error banner (`data-testid="draft-pick-error"`) does NOT appear.

---

## 3. Verify Board Advances

**After a pick is made:**

- [ ] The draft board scrolls to the next pick slot.
- [ ] The "On the clock" indicator moves to the next team.
- [ ] The round/pick counter increments correctly (e.g., "Round 1, Pick 3 → Round 1, Pick 4").
- [ ] The previous pick appears in the board with the correct player name and team.

---

## 4. Refresh and Verify Persistence

**After a pick has been recorded:**

- [ ] Hard-refresh the page (Ctrl+R / Cmd+R).
- [ ] The room loads and returns to the same draft state — previous picks still appear on the board.
- [ ] The player pool loads (skeleton → populated) without blocking the board.
- [ ] The timer resumes from the correct position (or shows correct remaining time).

---

## 5. Add / Remove / Reorder Queue

- [ ] Click the **+** button on a player row to add them to the queue.
- [ ] Queue panel shows the player name in order.
- [ ] Add a second player — both appear in the queue.
- [ ] Drag (or use up/down controls) to reorder — order updates immediately.
- [ ] Click remove (X) on a queue entry — player is removed from the queue.
- [ ] Refresh the page — queue persists (server-side) in the correct order.

---

## 6. Toggle "Auto-pick Me"

- [ ] Locate the **Auto-pick me** toggle in the controls panel.
- [ ] Toggle ON — UI acknowledges the preference (button state changes).
- [ ] Let the timer expire without making a pick.
- [ ] Confirm autopick fires from the queue (or best available) rather than a timeout/error state.
- [ ] Toggle OFF — autopick preference is cleared; next expiry should trigger the normal expired flow.

---

## 7. Commissioner Force Autopick

**Setup:** Logged in as commissioner or admin.

- [ ] Commissioner panel shows **Force Autopick** button for the current pick slot.
- [ ] Click **Force Autopick**.
- [ ] Network request to the autopick-expired route fires and returns 200.
- [ ] A pick is recorded on the board (best available from queue or pool).
- [ ] The turn advances to the next team.

---

## 8. Pause / Resume Timer

**Setup:** Draft is in `running` state with a live timer.

- [ ] Commissioner panel shows **Pause** button.
- [ ] Click **Pause** — timer stops for all users immediately (no page refresh needed).
- [ ] Non-commissioner users see the timer frozen.
- [ ] Commissioner clicks **Resume** — timer continues from where it stopped.
- [ ] Remaining seconds match what was shown when paused (within ~2 s tolerance).

---

## 9. Failed Pick / Duplicate Pick Protection

**Duplicate pick:**

- [ ] Identify a player who has already been drafted (shows "Drafted" badge in pool).
- [ ] Attempt to click **Draft** on that player (button should be disabled).
- [ ] Confirm no request fires and no pick is recorded.

**Network error simulation:**

- [ ] Throttle the network to offline in DevTools.
- [ ] Attempt to make a pick.
- [ ] An error banner or pick-error state appears (`data-testid="draft-pick-error"` or toast).
- [ ] The board does NOT advance (pick was not recorded).
- [ ] Restore network — existing board state is intact.

---

## 10. Player Pool Reload / Cache Behavior

**Cold load (first time):**

- [ ] Open the draft room URL in a fresh browser tab (no cache).
- [ ] Room shell (board, queue, timer) loads within ~5 s.
- [ ] Player pool shows **"Loading player pool..."** skeleton while pool is pending.
- [ ] Pool populates in the background — typically within 1–3 s on a cached response.

**Error state:**

- [ ] With DevTools, block the `/api/leagues/[leagueId]/draft/pool` endpoint (simulate 500).
- [ ] Player panel shows **"Failed to load player pool."** (not the loading skeleton, not blank).
- [ ] Draft board and session remain fully functional — picks, queue, and timer are unaffected.

**Cached response:**

- [ ] Reload the page after the pool has loaded at least once.
- [ ] Pool response should return `meta.source: "db-cache"` in the response JSON.
- [ ] Pool populates in under 500 ms on a cache hit.

**Empty pool (rare, e.g., misconfigured league):**

- [ ] If the pool returns 0 entries (not an error), panel shows **"No players loaded for this pool."**
- [ ] This message should never appear while the pool is still loading.

# NBA Survivor pilot readiness

The commissioner can configure a league and start a native draft, but the current build is **not ready for an unattended public full-season league**. Use a closed rehearsal league until the launch gates below pass end to end.

## Rules agreed for the NBA pilot

- Fantasy weeks run Tuesday through Monday in US Eastern time. The existing generic daily-sport week window still uses a UTC opener anchor; that must be corrected for this format before real scoring starts.
- Commissioners choose all-games scoring or one pregame game per player each week. If no selection is made, the player's first game of that week is selected automatically. The pregame selection, lock, and score pipeline remain to be built.
- Playing commissioners can change settings and approve or postpone a system-random tribe redraw at the 40% threshold, but cannot see private ballots, hidden idols, or other tribes' huddles.
- Shot in the Dark is one hidden use per manager with a 1-in-6 success probability. Its persisted use and official reveal are not yet implemented.
- Exile is on by default. A voted-out manager's main roster is released; one qualifying manager with the highest token balance returns at the configured deadline. The weekly host/Chimmy score-to-beat rule awaits the commissioner's examples.
- Idols follow real drafted players through trades, elimination, waivers, and claims. Only the current holder can see a hidden idol. Direct idol transfers are blocked in the native NBA pilot.

## Implemented in this branch

- Private `@Chimmy @manager` ballots and correction messages from the league, tribe, and draft chat entry points; official vote validation remains server-side.
- Post-create idol count setting, with draft-start lock, and seeding onto real completed-draft picks using only the three powers whose effects are implemented.
- Private idol assignment notice with the bound player's name and available headshot.
- The native draft-to-season roster bridge and transactional idol changes during trades, reversals, waiver claims, drops, and elimination.
- Private inventory follows the current owner, including while an idol-bearing player is on waivers.
- On 2026-10-15, `scripts/verify-nba-survivor-20-draft.ts` completed an isolated 20-manager, 12-round NBA Survivor draft with 240 verified current NBA players. It exercised draft start, pause/resume, a queue-first expired-timer pick, reciprocal traded picks, all 240 saved pick-chat cards, automatic completion, 20 season rosters, four tribes, and seven private idol notices. The synthetic league and managers were removed after verification; no production league was changed.

## Launch gates, in order

1. Build and verify Tuesday-to-Monday Eastern NBA scoring for both commissioner-selected modes, including daylight-saving changes, pre-tipoff locks, missed picks, stat corrections, and finalization.
2. Finish the draft rehearsal with actual users in browsers: scheduling, multi-device reconnect, live chat rendering, commissioner pick correction, private idol notice display, and commissioner blind mode. The isolated service-level 20-manager draft and its saved artifacts passed on 2026-10-15, but those browser and role checks remain.
3. Persist Shot in the Dark, implement the 40% tribe-switch prompt and unbiased redraw, and test member/huddle access before and after elimination and merge.
4. Define the Exile weekly score-to-beat contest from the commissioner examples; then verify token reset, challenge rewards, weekly roster exclusivity, and the single deadline return.
5. Verify the full weekly challenge slate, official ballots and Torch reveal, commissioner recovery controls, and season-finale flow under scheduled automation. The planned-season runner currently requires an enablement flag; confirm its production schedule and idempotent retries.
6. Complete a multi-account, full-week dry run with a playing commissioner and a non-playing commissioner before invitations extend beyond testers.

# Survivor extras: idol plays, Tribal control, ties and the join page

This package fills the last Survivor gaps. It works alongside the earlier handoffs:

- `../survivor-core/`
- `../survivor-theme/` (idol art and catalog)
- `../weekly-loop/` (vote, immunity, torch-out)
- `../exile/` (scroll, tokens)
- `../late-season/`
- `../tribes/`

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and states, then rebuild in the app's stack. **Don't ship them.**

All of these screens reuse existing assets (`survivor/idols/*`, `weekly/*`, `exile/*`, `late/*`, `tribes/*`) and `exile.css`. There's no new art to ship.

## 1. Play an idol (`IdolPlay`, `MobileIdolPlay`)

This replaces the generic "Play" button in `IdolVault` with a real flow for each idol. The tabs across the top are the idols you hold, and only you can see this page.

### Steal 3: four steps

1. **Pick a team.**
   - Any team still in the game, from either tribe.
   - Each row shows the tribe mark, the team's weekly average and its top 3 players.
2. **Pick 3 players.**
   - Tick exactly 3.
   - These players are disabled:
     - anyone whose game has started this week (locked);
     - players on IR.
3. **Make room.**
   - If your roster can't fit 3 more, you choose bench players to drop until it can.
   - Dropped players go to waivers.
   - If you have room, skip this step.
4. **Confirm.**
   - Shows "Coming to you" and "To waivers" side by side.
   - Shows the warning that Steal 3 is **not secret** and can't be undone.

**After you play it ("The hand has struck"):**

- The 3 players fly in.
- **League chat:** AF Host posts the raid.
- **The raided team** gets a DM and a push. They also get **top waiver priority** for the week.
- The idol leaves your vault.

**Server rules:**

- Run the whole move as one transaction: lock check, roster limits, drops, adds and the idol marked used.
- If any player locks between picking and confirming, reject the move and send the player back to step 2 with a message.

### Vote steal

- Pick a manager in your tribe who is going to Tribal Council. The immune manager is disabled.
- It's played in secret: you cast 2 votes.
- At the read, the victim's slip is stamped "Taken".

### Immunity idol

- A single confirm, with the vote deadline shown. No target.

**All other idol types** reuse the same layout: idol card on the left, target step in the middle, confirm. Read `when` and `target` from `idols/catalog.json`.

## 2. Tribal Council control (`TribalControl`)

The commissioner's weekly page. Tribal runs on its own; this page is where the commissioner watches it and steps in.

- **Timeline:** lineups lock → scores final → immunity → votes close → the read. The current stage is highlighted.
- **Five-step checklist:**
  1. Scores final.
  2. Immunity set.
  3. Votes close. "Close votes now" is available here.
  4. Read the scroll. "Start the reveal" is disabled until votes close.
  5. After the read: torch out, Exile, notifications and the moment page all run on their own.
- **Who has voted:** shows voted / not yet / missed, with a "Nudge" button (one push). It **never** shows who anyone voted for.
- **Sealed until the read:**
  - idol plays (hidden when `hideIdolsFromCommissioner` is on);
  - the votes;
  - the tie rule.
- **Step in:** "Extend votes 1 hour" (pushes the tribe) and "Pause league" / "Resume league".
- **Commissioner who also plays:** a note says the commissioner's own vote and idols work like everyone else's, and a co-commissioner settles anything that involves them.
- **Auto-reveal on / Manual reveal:** controls whether the read starts at the scheduled time or waits for the commissioner.
- **Audit log:** every action is logged: nudges, early close, extensions, pauses and the read.

## 3. Ties and revotes (`Revote`, `MobileRevote`)

This uses the `tieRule` from Survivor settings (default: revote, then season points).

| Tab | What happens |
|---|---|
| The tie | The scroll ends in a tie (e.g. 2–2). Both tied managers are shown with their vote counts. Nobody goes home yet. |
| Revote | Only the managers **not** in the tie vote, and only for the tied managers. Same parchment and urn as `VoteCast`. A 2-hour revote clock. A revote that isn't cast doesn't count. |
| Still tied | Season points decide: fewer season points goes home. Shows the torch out and the margin. If season points also tie, the commissioner decides, and it's logged. |

**Rules:**

- No new idols can be played during a revote. Idols already played stay played.
- The revote is read on a new scroll, the same way as the first.

## 4. Join page (`SurvivorJoin`)

What an invited manager sees when they open the invite link (the commissioner side is `SurvivorOnboarding`).

- **Hero:** the dusk background for the league's sport, a lit torch, league chips, the inviter, spots filled and the draft time, then "Join the island" → "You're in. Your torch is lit."
- **How Survivor works**, in six steps, each with existing art:
  1. tribe
  2. immunity necklace
  3. urn
  4. idol
  5. Exile token
  6. trophy
- **League settings**, **who's on the island** and **the tribes** (crests and buffs).
- **What it says about tribes and idols:**
  - Tribes are drawn at random when the league fills, so the invitee isn't shown a tribe yet.
  - 7 idols are hidden before the draft, and nobody knows where, not even the commissioner.

## Screens

| PNG | Shows |
|---|---|
| `IdolPlay.png` | Steal 3, step 1: pick a team |
| `IdolPlay--pick.png` | Step 2: pick 3, with locked and IR players disabled |
| `IdolPlay--room.png` | Step 3: drop bench players to make room |
| `IdolPlay--confirm.png` | Step 4: the raid summary and warning |
| `IdolPlay--played.png` | Played: players fly in, league chat and victim DM previews |
| `IdolPlay--vote.png` | Vote steal, played in secret |
| `MobileIdolPlay.png` / `--played.png` | Phone: pick 3, and the result |
| `TribalControl.png` / `--read.png` | Voting open; Tribal done (after nudge, early close, reveal) |
| `Revote.png` / `--ballot.png` / `--dead.png` | The tie, the revote ballot, season points decide |
| `MobileRevote.png` / `--cast.png` | Phone revote, before and after dropping it in the urn |
| `SurvivorJoin.png` / `--joined.png` | Invite page, before and after joining |

## Build notes

**Calculated on the server only:**

- tie resolution;
- revote eligibility;
- Steal 3 validation;
- waiver priority changes;
- vote-steal effects.

**Secrecy:**

- Never send votes, idol holders or idol plays to any client before the read. The only exception is the idol owner's own view.
- Steal 3 is the only idol that's public as soon as it's played.

**Other:**

- **Accessibility:** every state is reachable by keyboard. Colour is never the only signal (counts are always shown as numbers). Respect `prefers-reduced-motion` (no ink wipe, fly-in or urn drop).
- **Data:** never call provider APIs to learn response shapes; use `contracts/`. No secrets in logs, notifications or share links.
- **Sample data:** player names are real NFL players used as examples. Scores and projections are illustrative.

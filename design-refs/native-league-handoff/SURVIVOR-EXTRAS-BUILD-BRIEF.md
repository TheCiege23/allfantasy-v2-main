# Survivor extras build brief (for Codex)

This document says what to build from the Survivor extras handoff and in what order. The design lives in `design-refs/native-league-handoff/survivor-extras/`: `README.md` holds the detailed rules, `screens/*.png` are the visual source of truth, and `source/*.dc.html` are mockups. Read the mockups for layout, copy and states, then rebuild in the app's stack. **Don't ship them.**

It builds on the earlier Survivor handoffs in the same folder: `survivor-core/`, `survivor-theme/` (idol art and `idols/catalog.json`), `weekly-loop/` (vote, immunity, torch-out), `exile/`, `late-season/` and `tribes/`. There is no new art. Reuse `survivor/idols/*`, `weekly/*`, `exile/*`, `late/*`, `tribes/*` and `exile.css`.

## Ground rules (apply to every phase)

- **Calculations on the server only:**
  - Steal 3 validation, vote-steal effects, waiver priority changes, revote eligibility and tie resolution.
  - The UI only displays them.
- **Secrecy:**
  - Never send votes, idol holders or idol plays to any client before the read. The only exception is the idol owner's own view.
  - Steal 3 is the only idol that's public as soon as it's played.
  - The commissioner's page shows who has voted, **never who anyone voted for**.
- **Irreversible actions:** playing an idol, closing votes early, starting the read and a commissioner tie decision. Each one is a single guarded server action that writes to the audit log.
- **Accessibility:**
  - Every state is reachable by keyboard.
  - Colour is never the only signal; counts are always shown as numbers.
  - Respect `prefers-reduced-motion`: no ink wipe, fly-in or urn drop.
- **Repo rules (see `CLAUDE.md`):**
  - Don't add new API routes; extend existing ones.
  - Never call provider APIs to learn response shapes. Use `contracts/`.
  - No secrets in logs, notifications or share links.
- **Sample data:** player names in the mockups are real NFL players used as examples, and scores are illustrative. Don't hardcode them.

## Phases

### 1. Steal 3, end to end (`IdolPlay`, `MobileIdolPlay`)

It replaces the generic "Play" button in `IdolVault`. The tabs across the top are the idols the user holds, and only they can see the page.

1. **Pick a team:** any team still in the game, from either tribe. Each row shows the tribe mark, weekly average and top 3 players.
2. **Pick 3 players:** exactly 3. Players whose game has started this week (locked) and players on IR are disabled.
3. **Make room:** if the roster can't fit 3 more, the user drops bench players until it can. Dropped players go to waivers. Skip this step when there's room.
4. **Confirm:** "Coming to you" and "To waivers" side by side, with the warning that Steal 3 is **not secret** and can't be undone.

**Server:**

- One transaction covers the lock check, roster limits, drops, adds and marking the idol used.
- If any player locks between picking and confirming, reject the move and send the user back to step 2 with a message.

**After it's played ("The hand has struck"):**

- The 3 players fly in.
- AF Host posts the raid in league chat.
- The raided team gets a DM and a push, plus **top waiver priority** for the week.
- The idol leaves the vault.

**Done when:** a Steal 3 lands atomically, a lock race is rejected cleanly, and the raided team gets its notifications and waiver priority.

### 2. Vote steal and immunity (same layout)

- **Vote steal:**
  - Pick a manager in your tribe who is going to Tribal Council. The immune manager is disabled.
  - It's played in secret, and you cast 2 votes.
  - At the read, the victim's slip is stamped "Taken".
- **Immunity idol:** a single confirm with the vote deadline shown. No target.
- **Every other idol type** uses the same layout (idol card, target step, confirm), driven by `when` and `target` in `idols/catalog.json`.

**Done when:** a vote steal stays invisible to every client except its owner until the read, and the catalog drives every other idol without per-idol code.

### 3. Tribal Council control (`TribalControl`)

This is the commissioner's weekly page. Tribal runs on its own; this page is where the commissioner watches it and steps in.

- **Timeline:** lineups lock → scores final → immunity → votes close → the read, with the current stage highlighted.
- **Checklist:**
  1. Scores final.
  2. Immunity set.
  3. Votes close, with "Close votes now".
  4. Read the scroll. "Start the reveal" is disabled until votes close.
  5. Torch out, Exile, notifications and the moment page all run on their own.
- **Who has voted:** voted / not yet / missed, with a "Nudge" button that sends one push.
- **Sealed until the read:** the votes, the tie rule, and idol plays when `hideIdolsFromCommissioner` is on.
- **Step in:** "Extend votes 1 hour" (pushes the tribe), "Pause league" / "Resume league", and Auto-reveal on / Manual reveal.
- **Commissioner who also plays:** their own vote and idols work like everyone else's, and a co-commissioner settles anything that involves them.
- **Audit log:** every nudge, early close, extension, pause and read.

**Done when:** nothing on this page or in its API responses reveals a vote, and every action is in the audit log.

### 4. Ties and revotes (`Revote`, `MobileRevote`)

This follows `tieRule` from Survivor settings (default: revote, then season points).

1. **The tie:** the scroll ends tied (e.g. 2–2). Both tied managers are shown with their counts, and nobody goes home yet.
2. **Revote:**
   - Only managers **not** in the tie vote, and only for the tied managers.
   - It uses the same parchment and urn as `VoteCast`, on a 2-hour clock.
   - A revote that isn't cast doesn't count.
3. **Still tied:**
   - Fewer season points goes home. Show the torch out and the margin.
   - If season points also tie, the commissioner decides, and it's logged.

**Rules:**

- No new idols can be played during a revote. Idols already played stay played.
- The revote is read on a new scroll, the same way as the first.

**Done when:** tie resolution is fully server-side and every branch (revote decides, season points decide, commissioner decides) is covered by tests.

### 5. Join page (`SurvivorJoin`)

This is what an invited manager sees when they open the invite link. The commissioner side is `SurvivorOnboarding`.

- **Hero:** the dusk background for the league's sport, a lit torch, league chips, the inviter, spots filled and the draft time, then "Join the island" → "You're in. Your torch is lit."
- **How Survivor works**, in six steps, each with existing art: tribe, immunity necklace, urn, idol, Exile token, trophy.
- **Also shows:** league settings, who's on the island, and the tribes (crests and buffs).
- **Tribes and idols:**
  - Tribes are drawn at random when the league fills, so the invitee isn't shown a tribe yet.
  - 7 idols are hidden before the draft, and nobody knows where, not even the commissioner.

**Done when:** the page renders for a signed-out invitee and the join completes into the league.

## Screens

| PNG (in `survivor-extras/screens/`) | Phase |
|---|---|
| `IdolPlay.png`, `--pick`, `--room`, `--confirm`, `--played` | 1 |
| `MobileIdolPlay.png`, `--played` | 1 |
| `IdolPlay--vote.png` | 2 |
| `TribalControl.png`, `--read` | 3 |
| `Revote.png`, `--ballot`, `--dead`; `MobileRevote.png`, `--cast` | 4 |
| `SurvivorJoin.png`, `--joined` | 5 |

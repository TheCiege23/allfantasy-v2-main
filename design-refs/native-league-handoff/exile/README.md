# Exile Island tokens and Tribal Council scroll: Codex handoff

These visuals cover two Survivor-league moments:

1. **The Exile Island token.** It's a gold coin with a carved **E**.
2. **The Tribal Council results scroll.** It's the parchment the votes are read from once voting closes.

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups. Read them for spacing and copy, then rebuild in the repo's stack. **Do not ship them.**

The production files in `assets/` are SVG or CSS. You can ship them as they are, for example in `public/survivor/`.

## Assets

| File | Use |
|---|---|
| `token-coin.svg` | Banked token. Wallet, profile, Exile board, hero. Use at 40px or larger. |
| `token-coin-earned.svg` | Token earned. Toast and weekly recap; has glow rays. Pop it in with a 0.6s scale animation. |
| `token-coin-wiped.svg` | Tokens wiped by the Exile boss. Cracked, desaturated coin. |
| `token-empty.svg` | Empty slot on the "3 to return" progress row. |
| `token-icon.svg` | Simplified coin for **16–32px** (chips, rows, counts such as `×3`). Never shrink the full coin that far. |
| `scroll-sealed.svg` | Rolled scroll with cord and wax seal. The "results are in" state: push card, league home, tribe channel. |
| `scroll-roller.svg` | Wooden roller with gold end caps, used top and bottom. Stretch it horizontally with `preserveAspectRatio="none"`. |
| `parchment-texture.svg` | Tileable fibre/noise texture. CSS background on the parchment body. |
| `wax-seal.svg` / `wax-seal-broken.svg` | Original torch-emblem seal: intact, and broken after opening. |
| `exile.css` | Parchment body, torn edge (`clip-path`), vote slips, "does not count" stamp, verdict stamp, unroll and pop animations. |

**Fonts** (Google Fonts, OFL):

- **Cinzel 600/700:** scroll headings and stamps.
- **Caveat 500–700:** handwritten votes and tally.
- **Archivo:** app UI, as in the rest of the app.

## Behaviour

### Exile tokens

All three values below come from the existing schema:

| Rule | Schema field | Default |
|---|---|---|
| Tokens needed to return | `exileReturnTokens` | 3 |
| Token cap | `survivorTokenCap` | 5 |
| Boss wipes tokens | `bossTokenResetOnWin` / `survivorExileHarshTokenLoss` | — |

- **Weekly result:** `ExileWeeklyEntry.tokenEarned` triggers the earned toast. `ExileWeeklyEntry.tokenWiped` triggers the wiped toast. Those toggles already exist in `supabase_ensure_survivor_ui_tables.sql`.
- **Progress row:** shows filled coins up to the balance, then empty slots up to the return count, plus a thin gold bar and the line "N more tokens to return to the game".
- **Exile board:** rank, manager, week score and token icons. Show one wiped coin when the manager was wiped this week. Add a footer line with the boss score.

### Tribal Council scroll

The reveal mode comes from `survivorRevealMode`:

- **One at a time** (default): reads each vote with a 2.5s pause, or on tap.
- **All at once:** shows the full tally straight away.

States, in order:

1. **Sealed:** after `voteDeadlineAt`, show `scroll-sealed.svg` with "The votes are in". No vote data is sent to the client before the reveal.
2. **Unroll:** "Break the seal" mounts the open scroll. The body animates from `max-height: 0` to full height over 1.6s (keyframe `scUnroll`). Use a plain fade when `prefers-reduced-motion` is on.
3. **Reading:** each vote appears as a slip ("First vote", "Second vote", … "Last vote"). The name is handwritten, with a slight random rotation of about ±1.5°. The tally updates live with tally marks.
4. **Idol votes:** votes in `doesNotCountVoteIds` show struck through with a red **DOES NOT COUNT** stamp. The idol line ("Immunity idol played by X") appears when the first cancelled vote is read. Double votes (`isDoubleVote`) show as two slips.
5. **Verdict:** a red **VOTED OUT** stamp, the name in large handwriting and "N votes to M". If Exile is enabled, add the line "Heads to Exile Island with 0 tokens" with the token icon.

**Data rules:**

- Serve the reveal from `SurvivorTribalCouncil.revealSequence`, ordered by the server.
- The client only gets votes up to the current reveal step. Never send the full vote list to the client before `revealStartsAt`.
- Votes are anonymous: show the name voted for, never the voter.

**Phone:** the scroll fills the width, with a sticky bottom action ("Break the seal" / "Read the next vote") and Replay. On small screens the stamp sits under the name.

## Copy notes

- All wording is original. Avoid the TV show's catchphrases.
- The torch emblem on the seal is original artwork, not the show's logo.

## Tools

`tools/gen_coin.py` and `tools/gen_scroll.py` regenerate the SVGs. They need `fontTools` and the Cinzel 700 `.woff` from `@fontsource/cinzel`, because the coin's ring lettering is outlined to paths.

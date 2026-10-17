# Weekly Survivor loop: Codex handoff

This package covers three things that happen every Survivor week:

1. **Casting a vote**
2. **The immunity necklace**
3. **Torch-out**

These connect to the existing pieces:

- the results scroll (`../exile/`)
- the idols (`../survivor-theme/`)
- Exile Island (`../exile/`)

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout and copy, but don't ship them. The SVGs in `assets/` are production assets you can ship as they are.

## Assets

| File | Use |
|---|---|
| `urn.svg` | Carved clay voting urn (240×280). Shown under the ballot on the vote screen. |
| `immunity-necklace.svg` | Hero necklace (240×300): bead cord with a gold-and-jade tiki pendant. Used for the immunity win moment. |
| `immunity-necklace-icon.svg` | 64px badge. Shown on avatars, standings rows, chat and tribe lists for the immune manager. |
| `torch-lit.svg` / `torch-out.svg` | Tribal torch, lit and snuffed (smoke, ember), 240×300. |
| `torch-lit-icon.svg` / `torch-out-icon.svg` | 64px status icons: still in the game vs. voted out. |

The parchment ballot reuses `../exile/assets/parchment-texture.svg` and the Caveat and Cinzel fonts.

## 1. Cast your vote (`VoteCast`, `MobileVoteCast`)

- **Who appears:** the tribe going to Tribal Council.
- **Who can't be voted for:**
  - **Yourself**, when `selfVoteDisallowed` is on.
  - **The immune manager**, who shows a gold ring, the necklace badge and "Immune this week". Their row is disabled.
- **Writing the name:** picking a name writes it on the parchment ballot in handwriting. It's a left-to-right wipe (`clip-path`, about 1.1s, stepped), so it reads as being written.
- **Dropping it in the urn:** "Drop it in the urn" folds the ballot (scale down) and drops it into the urn (translate and fade, about 1.1s). The urn then bumps. After that the screen shows "Your vote is in the urn" and a "Change my vote" button.
  - Votes can be changed until `voteDeadlineAt`. Store only the latest vote (`SurvivorVote`, updated in place).
- **Votes in:** shows a count only ("3 of 4 managers have voted"). **Never show who voted for whom, or any partial tally, before the reveal.**
- **Idol prompt:** if the user holds a playable idol, show it with a link to play it (the play flow is in `../survivor-theme`).
- **Reduced motion:** with `prefers-reduced-motion`, skip the fold and drop and show the confirmation straight away.

## 2. Immunity necklace (`WeeklyMoments`)

- **Who wins:** each week the top score in each tribe going to Tribal Council wins immunity. Store it as `immunityWinnerRosterId` per tribe per week.
- **Win moment:** the hero necklace with a gentle sway animation and the line "**{Manager} wins immunity**", plus their score and "Safe at Tribal Council and can't receive votes this week".
- **Avatar treatment, everywhere the manager appears:**
  - a gold ring (`0 0 0 2px bg, 0 0 0 4px #f2c94c`, plus a soft glow)
  - the necklace badge at the bottom-right
- **Other places it shows:**
  - **Standings row:** gold tint and the badge.
  - **Chat / tribe channel:** the system line "{Manager} won immunity".
- **How long it lasts:** it's worn until the next lineup lock, then cleared.

## 3. Torch-out (`WeeklyMoments`)

- **When it plays:** right after the verdict on the results scroll, once.
  1. The flame shrinks and fades (about 1.4s).
  2. The smoke version fades in.
  3. The manager's avatar fades to greyscale.
- **Copy:** "**{Manager}, your torch is out**". All wording is original; don't use the TV show's catchphrases.
- **After a torch-out, across the app:**
  - **Avatar:** greyscale (`filter: grayscale(1) brightness(.6)`), a dim ring and the snuffed-torch badge.
  - **Standings and tribe lists:** name struck through, with an "Out · Wk N" chip.
  - **Tribe lists:** lit-torch and snuffed-torch icons show who is still in.
- **Exile handoff:** if Exile Island is enabled, the manager then goes to Exile.
- **Reduced motion:** with `prefers-reduced-motion`, swap the torch images instantly.

`tools/gen_weekly.py` regenerates every asset.

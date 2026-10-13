# Survivor core screens: Codex handoff

These screens complete Survivor around the moments already handed off:

- `../weekly-loop/`
- `../late-season/`
- `../share-cards/`
- `../exile/`
- `../survivor-theme/`

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups; read them for layout and copy. `kit.css` holds the shared components: toggle, stepper, timeline, skeleton loaders, empty states, notification preview and hero banner. Port these into the app's own components.

## 1. Survivor league home, desktop (`SurvivorHome`)

- **Hero:** uses `survivor/bg/{mood}-{sport}` and contains:
  - the league chips
  - this week's headline ("Tribe Vela goes to Tribal Council tonight")
  - a live countdown to `voteDeadlineAt`
  - the "Cast your vote" button
- **Tribe race:**
  - Shows the tribe totals, with a split bar sized by score.
  - The lowest total goes to Tribal Council.
  - The text below the bar names the immunity winner.
- **Tribe columns:**
  - Members show their score this week and a lit or snuffed torch icon.
  - The immunity winner has a gold ring and the necklace badge.
  - Voted-out members are greyscale and struck through.
- **Right rail:**
  - your private idols (visible only to the owner)
  - Exile Island token progress
  - the latest-moments feed

## 2. Commissioner Survivor settings (`SurvivorSettings`)

These are the settings the earlier READMEs refer to.

| Section | Settings | Default |
|---|---|---|
| Tribes | `tribeCount` 2–4, `tribeFormation` random / commissioner / snake by draft, crests | 2, random |
| Tribal Council | `voteDeadline`, `selfVoteAllowed`, `tieRule` (revote then season points, or season points) | Tue 8 PM ET, off, revote |
| Idols | `idolCount` 6–8, the idol picker (`IdolSetup`), `hideIdolsFromCommissioner` | 7, random, on |
| Exile Island | `exileEnabled`, `returnTokens` 1–5, `exileBossMode` median / fixed / topN | on, 3, median |
| Swap / merge / jury | `swapEnabled` + `swapWeek`, `mergeWeek`, `finalistCount` 2–3 | on, wk 5, wk 8, 3 |
| Sharing | `shareCardsEnabled`, `publicMomentPages` | on, on |

- **Locking:** settings lock when the draft starts. The exceptions are the vote deadline and the boss mode, which stay editable all season.
- **Season preview** (right column): updates live as settings change.
  - a 13-week strip marking Tribal Council, swap, merge and finale
  - a plain-English summary of what managers will see
  - a validation message, e.g. the swap must come before the merge
- **Saving:** the header shows how many changes are unsaved. Saving writes a single audit-log entry.

## 3. Season story and trophy case (`SeasonTimeline`)

- **Timeline:** has a node for the draft plus one per week. Each node shows the week's main event:
  - voted out
  - idol played
  - swap
  - Exile return
  - merge
  - juror seated
  - champion
- **Event card:** selecting a node shows that week's card, with the mood background, hero art, headline and chips. The data comes from the event log.
- **Trophy case:** one shelf per past season.
- **League records:** computed across seasons.

## 4. Public moment page (`MomentPage`)

This is the page shared links open: `/l/[leagueSlug]/moment/[momentId]`.

- **Top bar:** brand mark only, with "Sign in" and "Start a league".
- **Hero:** the moment headline and art, a short summary and the "Copy link" and "Share" actions.
- **Scroll section:** shows the names that were written down and their order, but never who voted.
- **Other sections:**
  - "Still in the game" torches per tribe
  - a call to action to start a league
  - three more moments from the same league
- **Privacy:** display names only. If `publicMomentPages` is off, show the private-league state from `SurvivorStates`.

## 5. Notifications (`SurvivorNotifications`)

There are eight Survivor notifications. Each has push copy, an email layout and a trigger.

| Notification | Trigger | Channels |
|---|---|---|
| Votes close soon | 2h before deadline, only if the manager hasn't voted | Push, email |
| You won immunity | immunity winner set | Push, email, chat |
| You found an idol | draft complete and the manager holds an idol | Push, email, DM. The email never names the idol. |
| Your torch is out | voted out and the scroll has been revealed | Push, email |
| Tribe swap | 24h before `swapAt` | Push, email |
| Back from Exile | tokens ≥ `returnTokens` | Push, email, chat |
| Jury vote is open | final week, recipient is a juror | Push, email |
| Season champion | final reveal complete | All members |

- **Email template:** 600px wide, with a mood background banner, the hero art, a kicker, a Cinzel headline, one paragraph, one call-to-action button and a link to notification settings.
- **Never include:** who voted for whom, other managers' idols, or vote tallies before the reveal.

## 6. Create a league, plus the first tribe reveal (`SurvivorOnboarding`, `MobileTribeReveal`)

- **The five steps:**
  1. **Format:** a grid of all league formats.
  2. **Sport and size.**
  3. **Tribes:** the crests can be shuffled.
  4. **Twists:** idols, Exile, swap, merge.
  5. **Invite:** a link, copy and share, and a "who's in" bar. The draft can't start until the league is full.
- **Live preview:** a card on the right updates the background, chips and crests as choices are made.
- **First tribe reveal (phone):** when tribes are drawn, each manager sees:
  - their crest pop in
  - their buff drop
  - their tribemates
  - an "Open tribe chat" button

  With reduced motion, show the end state straight away.

## 7. Empty, loading and error states (`SurvivorStates`)

There are 12 cards covering:

- **Empty:** the idol vault before and after the draft, and Exile Island with nobody on it.
- **Loading:** a skeleton of the home screen, and the scroll counting votes.
- **Error:** the scroll failed to load (with "Try again"), and the moment page is turned off.
- **Other states:** voting closed, missed vote, spectator, paused league, locked setting.

The missed-vote rule shown on the card is that votes not cast by the deadline simply don't count. Confirm this rule before shipping.

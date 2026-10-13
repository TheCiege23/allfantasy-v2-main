# Guilly: the NBA guillotine league

Guilly is AllFantasy's own guillotine format. The name keeps it separate from the generic "guillotine" leagues on other apps. It's NBA only for now.

Every week the lowest score in the league is chopped: **off with their head**. Their whole roster drops into a blind FAAB auction, and the last team standing wins.

Guilly works with:
- **Auction** or **snake** drafts.
- **Managed** lineups or **bestball** (lineups set automatically).

The art uses cartoon basketball "heads" (calm, nervous, knocked out, crowned) to keep eliminations fun rather than gory. There is no "created by KB" signature on Guilly art.

## Rules (proposed defaults; the commissioner can change them in `GuillySetup`)

| Setting | Default | Options |
|---|---|---|
| League size | 18 | 12, 14, 16, 18, 20 |
| Chops | League size − 1, one per week | Double-chop weeks (2 per week) so the season fits |
| First chop | Week 1 | Week 1–3 |
| Draft | Auction, $200 | Auction ($100 / $200 / $500) or snake |
| Lineups | Managed (daily) | Managed or bestball |
| Scoring and roster | Points and the Standard NBA roster (10 start, 13 slots + 1 IL) | Any NBA option in `../scoring-roster-labels` |
| Season FAAB | $1,000 | $500, $1,000, $2,000 |
| Chopped rosters go to | Blind FAAB, processed Tuesday 11:00 PM ET | Blind FAAB or free agency |

**Weekly cycle:**

1. The matchup week runs Monday to Sunday. Everyone races everyone.
2. Monday at 11:00 AM ET, after stat corrections, the lowest weekly score is chopped.
3. Tiebreaks:
   - At the blade line, the team with more season points survives. If season points are also tied, the commissioner decides.
   - On FAAB bids, ties go to the team with fewer season points.
4. Tuesday: the chopped roster goes to blind FAAB, with bids due Tuesday at 11:00 PM ET.

**Bestball:**
- Each day the best eligible players fill the lineup automatically, so bench points can count.
- The chop is still weekly, on the counted total.
- The only roster moves are FAAB bids on chopped rosters.

**Season length:** with a 24-week NBA season, an 18-team league ends in week 17. If a setup would run past the season, the screen warns and suggests double-chop weeks.

## Screens (`source/` boards, `screens/` PNGs)

| Board | What it shows | States |
|---|---|---|
| `GuillyHome` | The hub. Shows the live blade line for the week: current score, **games left** (key in the NBA), projected total, and a head icon for each team (calm, sweating or on the chopping block). The side panel shows "your neck" (margin over the line and a meter), the latest graveyard entries and a short how-it-works | Projected view |
| `GuillyChop` | Chop night. The bottom two are shown with scores hidden, then the commissioner presses "Drop the blade". The chop scene, the OFF WITH YOUR HEAD art and a screen shake follow, then the chopped team and its released players ("into the basket") | Pending, revealed (you survived), revealed (you were chopped) |
| `GuillyWaivers` | The waiver frenzy: the chopped roster with FP/game and games left, a blind bid per player, your bid sheet, and FAAB left after bids. Includes a note for bestball leagues | Two bids placed |
| `GuillyAuctionRoom` | Live auction. Shows the nominee (FP/game, games per week, Guilly value, rank), a countdown ring, bid buttons, your max bid, your roster slots with prices, the weekly floor projection, budgets and max bids for every team, and recent sales | Mid-draft |
| `GuillyDraftBoard` | An 18-team by 14-row board with cells coloured by position. Each team header has a head icon based on its projected weekly floor (bottom third = nervous = early chop risk). Auction mode shows prices and $ left; snake/bestball mode shows pick numbers and who's on the clock | Auction, snake/bestball |
| `GuillyBestball` | The week by day (counted points and games), the lineup that counted on a chosen day (bench players who counted are highlighted), the margin over the blade, and points saved by bestball | Wednesday, Friday |
| `GuillyGraveyard` | Tombstones for every chopped team (week, score, a funny "cause of death"), who's still standing, and the closest shaves | — |
| `GuillySetup` | Commissioner setup: every rule above, plus the scoring and roster label and a live summary (chops, last chop week, playoffs warning) | Auction + managed; snake + bestball |
| `GuillyShare` | 1080×1920 story cards: Survived week N, Chopped (off with my head), Last one standing | — |
| `MobileGuilly` | Phone hub: your neck, the meter, the chopping block | — |
| `MobileGuillyChop` | Phone chop result | Chopped, survived |
| `GuillyNotifications` | Every Guilly notification moment. Pick a moment on the left to see the lock-screen push stack, the in-app banner and the email. Includes the table of default channels | 12 moments (screens: chopping block, off with your head, on the clock) |
| `GuillyLineup` | Managed daily lineup: a day strip with your game counts, a warning when starters have no game, and "Fix lineup" (auto-swaps playing bench players into eligible slots). Shows questionable and rest-risk flags, the IL slot, and games left compared with the team below you | Warning, after fix |
| `MobileGuillyLineup` | Phone lineup with the same warning and fix | — |
| `GuillyControl` | Commissioner chop control: auto-chop on or off, a five-step checklist (scores final, stat corrections closed, check the bottom two, preview the basket, drop the blade), the bottom-two table with the tiebreak, after-chop jobs and the audit log | Before, blade dropped |
| `GuillyJoin` | Invite and join page: banner hero, spots filled, "How Guilly works" in 5 steps, league settings and members | — |
| `GuillyLobby` | Pre-draft lobby: countdown, ready check, nomination or draft order (asleep managers get a KO head), targets with max prices (auction) or queue (snake) | Auction, snake |
| `GuillyTrophy` | Season end: crowned champion, the 17-chop timeline, awards (closest shave, best frenzy buy, biggest bid, iron neck, saddest exit) and the final order | — |

## Notifications

| Moment | When | Push | In-app | Email | League chat |
|---|---|---|---|---|---|
| On the chopping block | Mid-week, when you drop below the blade line | On | On | Off | Off |
| Danger alert | Sunday, within 25 points of the line | On | On | Off | Off |
| Chop night is live | Monday, before the reveal | On | On | Off | On |
| Off with your head | You were chopped | On | On | On | On |
| You survived | Your head stays on | On | On | Off | Off |
| Waiver frenzy is open | Tuesday, after the chop | On | On | On | Off |
| Bid deadline | 1 hour before bids lock | On | On | Off | Off |
| Bid results | Wednesday, after processing | On | On | On | On |
| You're on the clock | Snake drafts | On | On | Off | Off |
| Your nomination | Auction drafts | On | On | Off | Off |
| You've been outbid | Auction drafts | On | On | Off | Off |
| Last team standing | After the final chop | On | On | On | On |

- Managers can turn off any channel.
- A notification never includes secrets, tokens or full provider URLs.
- Pushes link straight to the matching screen: the chopping block and danger alert open `GuillyLineup`, chop moments open `GuillyChop`, frenzy moments open `GuillyWaivers`, draft moments open the draft room, and the season end opens `GuillyTrophy`.

## Art (`svg/` plus 2× `png/`)

| File | What it is |
|---|---|
| `emblem.svg` | League badge: a guillotine with a nervous basketball head in the stocks and a GUILLY ribbon (300×340) |
| `wordmark.svg` | GUILLY wordmark with blade and head, tagline "LAST TEAM STANDING" (640×210) |
| `banner.svg` | Arena scene for "Chop Night": court, crowd, spotlights, a jumbotron and the guillotine (1600×500, crops from the centre) |
| `off-with-your-head.svg` | The elimination headline with a knocked-out head (900×300) |
| `chop.svg` | Elimination scene: the blade drops and the head rolls away (600×520) |
| `tombstone.svg` | Blank R.I.P. stone. The app writes the team name and week at about 50% height (200×240) |
| `head-calm`, `head-nervous`, `head-ko`, `head-crown` | Status heads: safe, sweating, chopped, champion (128×128) |
| `icon-chop`, `icon-danger`, `icon-safe`, `icon-crown`, `icon-faab`, `icon-gavel`, `icon-bestball`, `icon-tomb`, `icon-streak`, `icon-basket` | 64×64 icons |

All text in the art is drawn as vector paths, so it looks the same without the fonts. To regenerate, run `python3 tools/gen_guilly.py <outdir>`; it needs the Bebas Neue, Archivo and Caveat woff files (set `AF_FONTS`).

## Build notes

- **Calculated on the backend only:** chops, the blade line, tiebreaks, FAAB results and the bestball daily optimisation. The UI shows results and explains them.
- **Games left:** comes from the NBA schedule for the matchup week. Show it everywhere the blade line appears.
- **Chop reveal:**
  - A missing or provisional score blocks the chop.
  - "Drop the blade" is a single guarded commissioner action. It can also run automatically at the scheduled time, and it writes to the audit log.
- **Fix lineup:** the backend picks the swaps. It fills idle starter slots with bench players who play today and are eligible for that slot (UTIL takes anyone, G takes PG/SG, F takes SF/PF). If no one is left, the screen says so and points to free agents.
- **Auto-chop:** when it's on, the checklist runs at 11:00 AM ET and stops if any step fails (a missing score, an open stat correction or an unresolved tie). The commissioner gets an alert in that case.
- **Animations:** respect reduced motion. The blade drop, head roll and screen shake are CSS keyframes (`gy-blade`, `gy-roll`, `gy-shake`).
- **Data:** never call provider APIs to learn response shapes; use `contracts/`. No secrets in logs, notifications or share links.
- **Sample data:** player names in the screens are real NBA players used as examples. Values, prices and projections are illustrative.

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
- **Animations:** respect reduced motion. The blade drop, head roll and screen shake are CSS keyframes (`gy-blade`, `gy-roll`, `gy-shake`).
- **Data:** never call provider APIs to learn response shapes; use `contracts/`. No secrets in logs, notifications or share links.
- **Sample data:** player names in the screens are real NBA players used as examples. Values, prices and projections are illustrative.

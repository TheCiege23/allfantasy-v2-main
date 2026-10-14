# Zombie: full visual set

Zombie is AllFantasy's universe format. Leagues sit on a ladder of levels: Gamma at the bottom, then Beta, then Alpha at the top. One Whisperer per league. Everyone else starts as a Survivor, and losing to the horde turns you into a Zombie.

This package adds everything the format was missing visually:

- the turn from human to Zombie;
- weapons and serums;
- bashings and maulings;
- the Whisperer;
- every notification;
- the 10 league backgrounds;
- universe standings and the weekly board;
- commissioner control;
- the join page;
- the season end;
- share cards.

The rules come from the repo, not invented: `lib/zombie/sportRulesConfig.ts`, `ZombieWeaponEngine`, `ZombieSerumEngine`, `maulingEngine`, `whispererEngine`, `zombieBackgroundThemes.ts` and `docs/PROMPT351_ZOMBIE_LEAGUE_PRODUCT_SPEC.md`. Proposed values that aren't in code yet are marked **(proposed)**.

`screens/` is the visual source of truth. `source/*.dc.html` are design mockups: read them for layout, copy and states, but don't ship them. `svg/` holds production assets you can ship as-is (e.g. `public/zombie/`). `png/` has 2× renders.

## Rules the visuals follow

| Thing | Rule | Source |
|---|---|---|
| Universe | 1, 3 or 6 leagues (Gamma only / 2 Beta + 1 Gamma / 1 Alpha + 2 Beta + 3 Gamma). 8–16 teams. Snake draft, no playoffs | audit report, `zombie-universe-tier.ts` |
| Statuses | Survivor, Zombie, Whisperer, Revived | spec 1.3–1.4 |
| Infection | Lose to a Zombie or the Whisperer and you turn. Results run after stat corrections (NFL: Tuesday). | spec 1.8, sport config |
| Stat-correction reversal | A 48-hour window; a corrected result undoes the infection | weekly resolution |
| Weapons (NFL lines) | Knife 120+, Axe 140+, Bow (top 2 Survivor score, 100+), Gun 160+, Bomb (season high, one-time) | `sportRulesConfig.ts` |
| Weapon effects **(proposed)** | Knife +4, Axe +6, Bow +5, Gun +8 against a Zombie or the Whisperer. Bomb cancels one infection. Top two active. Used up when they fire. Zombies can't use weapons. | |
| Serums | Earned for the season high, the weekly top Survivor score, or surviving a bashing. Hold up to 5. 3 serums revive a Zombie. | `ZombieSerumEngine`, `zombieRules.ts` |
| Serum shield **(proposed)** | 1 serum, set before lineup lock, keeps you human for one week if you lose to the horde | Chimmy intent "use serum protect" |
| Bashing | A Survivor beats a Zombie or the Whisperer by 30+ (NFL). The winner loots 1 item. | thresholds in sport config |
| Surviving a bashing **(proposed reading)** | A Survivor who loses to another Survivor by 30+ stays human and gets a serum | serum award `bashing_survived` |
| Mauling | A Zombie or the Whisperer wins by 50+ (NFL). Loot ×2 (`lootMultiplier: 2`). The commissioner is alerted. | `maulingEngine` |
| Whisperer overthrown | A Zombie mauls the Whisperer: the old Whisperer becomes a Zombie, and either the commissioner decides or a new Whisperer rises from the horde with half the remaining ambushes (minimum 1) | `handleWhispererDefeat` |
| Ambush | 3 per season. NFL deadline Wednesday 11:59 PM ET. **(proposed)** The target faces the Whisperer that week instead of their scheduled opponent, revealed at lineup lock. A target can't be hit twice in a row. | `applyAmbush`, sport config |
| Powers | Horde command (1), Dark whisper (2), Infection override (1), Mass serum burn (1). **(proposed effects)**: Zombies +5 for a week; see one Survivor's supplies; one serum shield fails; every Survivor loses 1 serum. | `WHISPERER_POWER_KEYS` |
| Bash / maul lines by sport | NFL 30/50, NBA 45/70, MLB 40/65, NHL 8/14, NCAAF 35/55, NCAAB 40/65, Soccer 25/40 | audit report |

## Screens

| Board | What it shows | States (PNG) |
|---|---|---|
| `ZombieTurn` | Infection night for one manager. The avatar morphs **Survivor → Bitten → Turning → Zombie** with a green flash and a shake. Also shows the matchup, what changes now, your stash, the record line and the rest of the league tonight. | turned, survived, serum shield, revived |
| `MobileZombieTurn` | The same turn on a phone | — |
| `ZombieArmory` | Weapons tab (5 cards, earn line, effect, count, arm up to 2 for the week) and Serums tab (serum, shield, revive), plus the ledger | weapons, armed, serums |
| `MobileZombieArmory` | Arm weapons on a phone | — |
| `ZombieBashing` | Blowout card with a margin meter (bash and maul lines), loot moving across, a table of lines by sport, and this week's blowouts | bashing, mauling, Whisperer overthrown |
| `ZombieWhisperer` | Whisperer-only lair: ambushes left, pick a Survivor to ambush (sealed until lock), 4 powers with uses left, your horde. Plus the victim's "You've been ambushed" view. | lair, ambush set, ambushed |
| `MobileZombieWhisperer` | Set an ambush on a phone | — |
| `ZombieNotifications` | 19 moments: lock-screen stack, in-app banner, email (with the background art) and the default-channel table | default (you turned), ambushed, bashed |
| `MobileZombieInbox` | Phone notification inbox, with unread dots | — |
| `ZombieBackgrounds` | All 10 scenes, a live league-header preview, the commissioner's "new scene each season" setting, and the layout rules | Graveyard Dawn, Quarantine Zone |
| `ZombieUniverse` | Infection meter per league, the standings table (status, points, per week, winnings, supplies, turned by, next season) and the movement rules | everyone, horde filter |
| `ZombieWeeklyBoard` | "The Outbreak Report": turned, blowouts, supplies, Whisperer watch, movement watch, and how it's pinned in chat | — |
| `ZombieControl` | Commissioner weekly run (5 steps, auto-run or approve), a preview of what the week will do, stat-correction reversal, Whisperer settings and the audit log | before, approved + posted + reversed |
| `ZombieJoin` | Invite page: background hero, spots, how it works in 6 steps, settings, the universe ladder and who's in | before, joined |
| `ZombieSeasonEnd` | Who's still human, 6 awards (Patient zero, Top of the horde, Head basher, Back from the dead, Untouchable, Kingslayer), who moves up, final order | — |
| `ZombieShare` | Story cards: I turned, Bashed, Still human, The Whisperer fell | — |
| `ZombieHome` (updated) | Now 12-team leagues to match the code limits, links to the new screens, and the corrected serum copy | — |

## Notifications and default channels

| Moment | Push | In-app | Email | League chat |
|---|---|---|---|---|
| You face the horde (Sunday) | On | On | Off | Off |
| Lineup lock reminder | On | On | Off | Off |
| Ambushed (at lock) | On | On | On | Off |
| Infection results are in | On | On | Off | On |
| You turned | On | On | On | On |
| You survived | On | On | Off | Off |
| Shield held | On | On | Off | Off |
| Revived | On | On | On | On |
| Stat correction reversal | On | On | On | Off |
| Weapon earned | On | On | Off | Off |
| Serum earned | On | On | Off | Off |
| Bashing | On | On | Off | On |
| Mauled | On | On | On | On |
| You're the Whisperer | On | On | On | Off |
| Ambush set (Whisperer only) | On | On | Off | Off |
| Whisperer overthrown | On | On | On | On |
| Weekly board posted | Off | On | Off | On |
| Movement watch | On | On | On | Off |
| You're on the clock | On | On | Off | Off |

**Secrecy rules for notifications:**

- Ambush targets and Whisperer power use are never pushed to anyone but the Whisperer before lineup lock. The commissioner sees "target sealed" in the audit log.
- Never include other managers' supplies (unless Dark whisper was used on them) or full provider URLs.

## Art (`svg/`, plus 2× `png/`)

| File | Use |
|---|---|
| `char-survivor`, `char-bitten`, `char-turning`, `char-zombie` | The four turn frames (200×200). Cross-fade them on infection night: 0.9s, 1.9s, 2.9s. |
| `char-revived`, `char-whisperer` | Revived Survivor (bandage, gold badge) and the hooded Whisperer |
| `status-survivor/zombie/revived/whisperer` | The same art for avatars and chips; readable at 28px |
| `turn.svg` | All four stages in one strip (800×250), for emails, share cards and how-it-works |
| `weapon-knife/axe/bow/gun/bomb` | Weapon card art (240×300) |
| `serum`, `serum-shield`, `serum-revive` | Serum, the 1-serum shield, the 3-serum revive |
| `bash`, `maul` | Blowout art with outlined BASHED / MAULED stamps |
| `whisperer.svg`, `ambush.svg` | Whisperer full figure and the ambush moment |
| `power-horde/whisper/override/burn` | The 4 Whisperer powers (128×128) |
| `bg/<theme-id>.svg` | The 10 backgrounds, 1600×600, named after the ids in `zombieBackgroundThemes.ts` |

- **Backgrounds** replace the gradient-only themes:
  - Use `object-fit: cover`, with `object-position: 62% 60%` on desktop and 66% on phone.
  - Add the two overlays (copy them from `ZombieBackgrounds`).
  - Use the theme's `accentColor` for the league title.
- **No gore:** nothing is bloody. Goo is green, and bites are tooth marks.
- **Original art:** no real logos and no show references.
- **Fonts:** all text in the art is outlined, so it renders without the fonts installed.
- **Regenerating:** run `python3 tools/gen_zombie.py <out>` and `python3 tools/gen_zbg.py <out>`. Both need the Bebas Neue woff (set `AF_FONTS`).

## Build notes

- **Server-only:** infection resolution, loot, thresholds, weapon firing, shields, revives, reversals and ambush resolution. The UI only shows the results.
- **Animations:** respect `prefers-reduced-motion` (show the final frame, no shake or loot fly-in). The keyframes are `zbIn`, `zbOut`, `zbFlash`, `zbShake`, `zbFloat` and `zbLoot` in the source CSS.
- **Data:** never call provider APIs to learn response shapes; use `contracts/`. No secrets in logs, notifications or share links.
- **Sample data:** names and scores in the screens are illustrative.

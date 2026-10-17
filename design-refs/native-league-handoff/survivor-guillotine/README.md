# Survivor Guillotine: full visual set

Survivor Guillotine combines Survivor tribes and idols with the Guillotine chop:

- Each week the tribes race on total fantasy points.
- In the losing tribe, the lowest score is chopped automatically. Nobody votes.
- A hidden idol played before lock can knock the blade to the next lowest.
- At 6 left the tribes merge, and from then on the lowest score overall is chopped.
- The last one standing wins.

**Rules status.** There is no Survivor Guillotine engine in the repo yet, so the format as a whole is **proposed**. Each piece is built from real engine code wherever it exists:

| Piece | Comes from |
|---|---|
| Tribes, merge, idol pool, idol share, idol expiry, blind mode | `lib/survivor/*`: `constants.ts`, `SurvivorLeagueConfig.ts`, `SurvivorMergeEngine.ts`, `SurvivorIdolRegistry.ts`, `commissionerBlindMode.ts` |
| Danger tiers, tiebreak order, correction window, roster release, endgame formats | `lib/guillotine/*`: `constants.ts`, `GuillotineDangerEngine.ts`, `GuillotineTiebreakResolver.ts`, `GuillotineLeagueConfig.ts`, `endgameEngine.ts` |

**What's in this package:**

- `screens/` is the visual source of truth.
- `source/*.dc.html` are design mockups. Read them for layout, copy and states, but don't ship them.
- `svg/` holds production assets.
- `png/` has 2× renders of the same art.

## Tribe setup (commissioner)

`SGTribeSetup` and `MobileSGTribeSetup` let the commissioner set tribes before the draft:

- **How many tribes:** 2 to 8, limited to counts where each tribe has 2–6 managers (the Survivor limits). For 12 managers that means 2–6 tribes. 2 is the default.
- **Rival pairs** (2 tribes only): Vela vs Koa, Sun vs Moon, Fire vs Ice, Blade vs Torch, Sharks vs Panthers, Day vs Night, Thunder vs Tide, Reef vs Ridge, Gold vs Silver, Hawks vs Wolves, Jungle vs Shore, Rise vs Fall. Each pair comes with its own colors and symbols.
- **Theme packs** (any number of tribes, 8 names each, used in order):

  | Pack | Names |
  |---|---|
  | Island words | Vela, Koa, Nalu, Lani, Kai, Ori, Tama, Ula |
  | Elements | Fire, Water, Earth, Wind, Storm, Stone, Frost, Sun |
  | Wild | Sharks, Panthers, Cobras, Hawks, Rhinos, Wolves, Bulls, Crabs |
  | Sky | Sun, Moon, Star, Comet, Dawn, Dusk, Aurora, Eclipse |
  | Colors | Red, Blue, Gold, Green, Purple, Orange, Teal, Pink |
  | Weather | Thunder, Tide, Breeze, Blaze, Mist, Hail, Heat, Quake |

- **Name them yourself:** a name field per tribe. Tap to cycle the color (8) and the symbol (10).
- **Surprise me:** picks another pair or pack.
- **Merged tribe:** a name field plus color and symbol. Suggestions: Ember (default), Unity, Tempest, Solstice, Horizon, Kinship.
- **Preview:** live buffs, the week 1 matchup (2 tribes) or "lowest tribe total goes to the chop" (3+ tribes, proposed), the merged buff, and a validation status.
- **Name rules:**
  - 2–16 characters: letters, numbers, spaces, apostrophes and hyphens.
  - All names must be unique, including the merged name.
  - Names go through the same profanity check as chat (`lib/profanity.ts`).
  - Renames are allowed until week 1 lineup lock and are logged **(proposed)**.
- **Art for any name:** `svg/tribes/buff-<color>.svg` are blank buffs in purple, teal, orange, red, gold, green, blue and pink. `svg/tribes/sym-<name>.svg` are white symbols: star, wave, flame, leaf, sun, moon, bolt, mountain, fin and shell. Compose them in the UI the way `.tb` does in the source: the buff image, the symbol on top, and the name as live text (Bebas Neue, 1px ink stroke). That way custom names never need new art.
- **Commissioner control:** `SGControl` now links to tribe setup from its overrides card.

## Rules the visuals follow

| Thing | Rule | Source |
|---|---|---|
| Tribes | 2–8 tribes of 2–6 managers. The sample league has 2 tribes of 6 (Vela and Koa). Tribes are drawn after the draft. | Survivor limits (`MIN/MAX_TRIBES`, `MIN/MAX_TRIBE_SIZE`) |
| Tribe race **(proposed)** | Starters' points are summed per tribe; tribes of unequal size compare the average. The lower tribe loses. | — |
| Chop **(proposed)** | Lowest score in the losing tribe; 1 chop per week | Guillotine `teamsPerChop` default 1 |
| Danger tiers | Chop zone = lowest projected. Danger = within 10 points. Safe = everyone else. Applying the tiers inside one tribe is proposed. | `DEFAULT_DANGER_MARGIN_POINTS = 10` |
| Tiebreak | Bench points → season points → previous week → draft slot → commissioner → random (lower loses) | `DEFAULT_TIEBREAKER_ORDER` |
| Chop timing | After the 48-hour stat-correction window. The sample uses Wednesday 10:00 AM ET. | `DEFAULT_STAT_CORRECTION_HOURS` |
| Chop weeks | NFL weeks 2–18. The default end week by sport is NFL 18, NBA 24, MLB 26, NHL 24, NCAAF 14, NCAAB 20, Soccer 38. | Guillotine config |
| Released roster | `next_waiver_run` (default); `immediate` and `custom_time` also allowed | Guillotine release modes |
| Idols | About 32% of the league gets one; each is unique and hidden. They expire when 5 managers are left. | `IDOL_DISTRIBUTION_PERCENT`, `DEFAULT_IDOL_EXPIRY_PLAYERS_REMAINING` |
| Idol pool for this mode **(proposed)** | Kept: protect_self (shown as **Blade Block**), score_boost_10/20 (**Torch Boost**), rival_penalty_10 (**Curse**), idol_sniffer, tribe_immunity_modifier (**Tribe Shield**), steal_one_player, swap_starter, waiver_priority_override, faab_bonus, force_tribe_shuffle, reveal_tribe_powers. Left out: every vote power, because nobody votes. | `IDOL_POWER_TYPES` |
| Idol play **(proposed)** | Played before lineup lock, then sealed until the chop. Spent even if the blade never reaches you. Two Blade Blocks in one tribe push the blade up twice. | — |
| Shuffle | Redraws tribes among managers still in. It can be scheduled or forced with `force_tribe_shuffle`. | `SurvivorTribeShuffleEngine` |
| Merge | By player count. The sample merges at 6 left (week 8). Merge by week is also supported, with these defaults: NFL 10, NBA 14, MLB 16, NHL 18, NCAAF 8, NCAAB 12, Soccer 12. | `SurvivorMergeEngine`, `DEFAULT_MERGE_WEEK_BY_SPORT` |
| After the merge **(proposed)** | Lowest score overall is chopped. The week's top scorer wears the immunity necklace for the next week. | — |
| Endgame | `last_team_standing` (default), `final_two`, `final_three` or `final_four` | `endgameEngine.ts` |
| 3+ tribes **(proposed)** | Every tribe races; only the last-place tribe goes to the chop. A tie for last compares bench totals, then season points. Tribe Shield lifts a tribe out of last place. | — |
| Tribe draw **(proposed)** | Runs when the draft ends. Balanced snake by draft slot (random is the other option), seeded and logged. Idols are dealt privately right after. | — |
| Tribe chat **(proposed)** | One members-only channel per tribe. Shuffles move you between channels. Tribe channels turn read-only at the merge, when the merged channel opens. AF posts a chop card to the league channel. | Survivor tribe chat provisioning |
| Stat-correction reversal | Only possible in `immediate` correction mode. A correction inside 48 hours that changes the lowest score restores the chopped team, as long as its roster hasn't cleared waivers, and chops the new lowest. | Guillotine `CORRECTION_IMMEDIATE`, `statCorrectionHandler.ts` |
| Commissioner blind mode | The commissioner can't see idol holders or plays until the chop reveals them | Survivor `commissionerBlindMode` |

## Screens

| Board | What it shows | States |
|---|---|---|
| `SurvivorGuillotineHome` (updated) | League home. You now hold a Blade Block; links to every new board. | — |
| `MobileSurvivorGuillotine` (updated) | Phone home, with "Open my idol" | — |
| `SGTribeRace` | Tribe buffs, live totals and projections, members, how the race works | live, final |
| `SGChopZone` | Danger tiers inside the losing tribe; a tie example walking down the tiebreak ladder | tiers, tiebreak |
| `SurvivorGuillotineChop` (rewritten) | 7-step chop night: blade over O8 → O8's idol → slides to you → your idol → slides to O4 → chopped, torch snuffed, roster released | start, first idol, your idol, chopped |
| `SGIdolVault` / `MobileSGIdol` | Your idol (play, take back, sealed), the pool for this mode (kept vs left out), Idol Sniffer result | idol, played, pool, sniffer |
| `SGTribes` | Tribes with chopped managers greyed out, plus an example idol-forced shuffle | tribes, shuffle |
| `SGTribeSetup` / `MobileSGTribeSetup` | Commissioner tribe count, rival pairs, theme packs, custom names, merged tribe, live preview | pairs, packs (4 tribes), custom, custom with errors |
| `SGMerge` | Vela + Koa → Ember, the six who made the merge, and what changes | before, merged |
| `SGFinale` | Final two with torches, the winner, and the endgame options | live, winner |
| `SGNotifications` / `MobileSGInbox` | 18 moments: lock screen, in-app banner, email and the channel table, plus a phone inbox | saved, chopped, merge |
| `MobileSGChop` | The chop live on a phone | start, chopped |
| `SGControl` | The weekly run (pause), idols under blind mode, overrides, audit log, settings | live, paused |
| `SGBackgrounds` | The 4 scenes and what each is used for | beach, chop stage |
| `SGJoin` | Invite page with 6 steps, settings and who's on the island | before, joined |
| `SGSeasonEnd` | Winner, chop timeline (weeks 2–12) and 6 awards | — |
| `SGMultiRace` | 3+ tribe race: ranked tribes, last place to the chop, the lowest inside that tribe | 4 tribes of 3, 3 tribes of 4 |
| `SGTribeDraw` / `MobileSGTribeDraw` | Post-draft tribe deal (balanced snake by draft slot, seeded), then the private hidden-idol reveal | drawing, idol sealed or open |
| `SGTribeChat` | Members-only tribe channel, league channel with the AF chop card, merged channel | tribe, league + chop card, after the merge |
| `SGLineup` | Lineup with the blade meter (chop zone, danger, safe), a "move off the blade" swap tip, and a shortcut to play the idol | before lock, live + swapped |
| `SGWaivers` | The chopped roster on waivers, FAAB bids, your claims, and the release options | bidding open, processed |
| `SGReversal` | Immediate-mode chop overturned by a stat correction inside 48 hours: torch relit, roster pulled from waivers, new chop | Tuesday chop, Wednesday reversal |
| `MobileSGRace` / `MobileSGMerge` | The tribe race and the merge on a phone | before, merged |
| `SGShare` | Story cards: The blade missed me, My torch is out, Made the merge, Last one standing | — |

## Notifications and default channels

| Moment | Push | In-app | Email | Tribe chat |
|---|---|---|---|---|
| Your tribe is trailing | On | On | Off | On |
| Idol reminder (1 hour before lock) | On | On | Off | Off |
| You're in the chop zone | On | On | Off | Off |
| Idol played (your confirmation) | On | On | Off | Off |
| Tribe race final | On | On | Off | On |
| Your idol saved you | On | On | On | Off |
| You were chopped | On | On | On | Off |
| Someone was chopped | Off | On | Off | On |
| Roster released | On | On | Off | Off |
| Tribe shuffle | On | On | On | On |
| The merge | On | On | On | On |
| Immunity necklace | On | On | On | On |
| You were given an idol | On | On | On | Off |
| Idol Sniffer result | On | On | Off | Off |
| Idols expiring | On | On | On | Off |
| Final two | On | On | On | On |
| Winner | On | On | On | On |
| You're on the clock | On | On | Off | Off |

**Secrecy rules for notifications:**

- Never reveal who holds or played an idol before the chop reveals it. That applies to notifications, chat, share cards and the commissioner when blind mode is on.
- A sniffer result goes only to the manager who used it.
- No full provider URLs or secrets in any message.

## Art (`svg/`, plus 2× `png/`)

| File | Use |
|---|---|
| `guillotine`, `guillotine-drop` | Bamboo guillotine with torches, blade up and blade down with a CHOPPED stamp (240×300) |
| `torch-lit`, `torch-out` | Alive and chopped (snuffed, with smoke) |
| `idol-block`, `idol-boost`, `idol-curse`, `idol-sniffer`, `idol-tribe` | Tiki idols for the 5 headline powers |
| `buff-vela`, `buff-koa`, `buff-ember` | Tribe buffs; Ember is the merged tribe |
| `necklace` | Post-merge immunity |
| `merge` | Two buffs joining into Ember |
| `winner` | Golden torch and blade with laurels |
| `bg/beach-dusk`, `bg/jungle-camp`, `bg/chop-stage`, `bg/merge-feast` | 1600×600 backgrounds |
| `banner`, `emblem`, `icon-*` | Existing league identity, included unchanged |

- **Backgrounds:** use `object-fit: cover` at `70% 60%` with the left-to-right dark veil (`.bb-hl`, `.bb-hl.dk` in the source CSS).
- **Original art:** no gore, no show logos.
- **Fonts:** all text in the art is outlined, so it renders without the fonts installed.
- **Regenerating:** run `python3 tools/gen_sg.py <out>`. It needs the Bebas Neue woff (set `AF_FONTS`).

## Build notes

- **Server-only:** the race, chop, idol resolution, tiebreaks, merge and roster release run on the server, deterministic and audited. The UI only shows results.
- **Animations:** respect `prefers-reduced-motion` (show the final state). The keyframes are `sgFall`, `sgKnock`, `bbPop` and `bbGlow`.
- **Data:** never call provider APIs to learn response shapes; use `contracts/`. No secrets in logs, notifications or share links.
- **Sample data:** names and scores are illustrative. The sample league is "Blade & Torch", 12 managers, week 6.

# Native League Hub — Codex build handoff

**Owner:** Guap (AllFantasy) · **Date:** 2026-10-11 · **Status:** design approved, ready to build

This is the visual spec for leagues that are **native on AllFantasy**, meaning they were created or imported and now run on AF instead of their original platform. It covers the league home, matchup, lineup, waivers, trades, standings, chat, commissioner tools, Draft HQ (mock, live, supplemental), the live draft room for every draft type, and Survivor (tribes and hidden idols).

- `screens/` holds the PNG of every screen. Treat these as the visual source of truth. Desktop is 1440 wide and phone is 390 wide, both at 2x.
- `source/` holds the design files the PNGs were rendered from (`.dc.html` plus two CSS files). Use them to read **exact spacing, colours and copy**. They are design mockups, not production code: **do not ship or import them.** Rebuild them in the repo's own stack (Next.js + Tailwind + existing `components/core-app`).
- All names, stats, scores and ADP values in the mockups are **sample data**. Wire every number to real data.

---

## 0. Ground rules for this build

1. Follow `CLAUDE.md` / `AGENTS.md` at the repo root. Those rules win over anything in this file. In particular:
   - Use `contracts/` for provider response shapes. Never call provider APIs to discover them.
   - Never log secrets (`RSC_token`, the TheSportsDB key). Never log full Rolling Insights request URLs, because the token is a query parameter.
   - DB-first boundary.
   - Stage explicit paths. Never use `git add -A`.
   - Run a secret scan before every push. The repo is public.
2. Reuse what exists before adding anything new:
   - Survivor schema: `supabase_ensure_survivor_tables.sql`, `supabase_ensure_idol_enhancements.sql`, `supabase_ensure_survivor_ui_tables.sql`
   - Draft schema: `supabase_ensure_draft_tables.sql`
   - Specs: `02–05_SUPPLEMENTAL_DRAFT_*.md`, `MOCK_DRAFT_TASK.md`, `LEAGUE_PAGE_TASK.md`, `01_AT_MENTIONS_SYSTEM.md`
   - Existing Draft HQ phase-1 work
   
   Extend these. Do not fork them.
3. Ship in the phases in §9. Each phase must pass typecheck, lint and tests, plus a Playwright screenshot compared against the matching PNG.

---

## 1. Design tokens (the "sleek" look)

All screens use one token set. Add it as Tailwind theme extensions or CSS variables scoped to the league shell. Do not hardcode hex values in components.

| Token | Value | Use |
|---|---|---|
| `bg` | `#07080d` | page background |
| `p1` / `surface2` | `#0b0d14` | inputs, inset wells, phone bottom bar |
| `p2` / `surface` | `#10131c` | cards, board cells |
| `p3` | `#151926` | raised and hover states, chat bubbles from others |
| `line` | `rgba(255,255,255,.06)` | hairline borders |
| `line2` | `rgba(255,255,255,.10)` | stronger borders, buttons |
| `t1` | `#e8eaf2` | primary text |
| `t2` | `#a3a9c2` | secondary text |
| `t3` | `#6f7590` | labels and meta |
| `accent` | `#22d3ee` | AF cyan: primary buttons, active nav, the AF pick |
| `accent-ink` | `#04050c` | text on cyan |
| `gold` | `#d9b45a` | Survivor and idols, Chimmy channel, commissioner |
| `good` / `warn` / `bad` | `#3fbf95` / `#e0a84a` / `#e5728a` | win, alert, loss |
| Position QB / RB / WR / TE | `#e5728a` / `#3fbf95` / `#5b9cf0` / `#e0a84a` | position pills and the left edge of board cells |
| Tribes Koa / Rumo / Vela / Tika | `#4fb8a8` / `#d98a55` / `#9b8ae0` / `#d46f86` | Survivor tribe colours. These are the defaults; the commissioner can change them. |

**Type:**
- Archivo at 400/500/600/700, for UI.
- JetBrains Mono at 400/500/700, for numbers, pick numbers and timers. Always use `tabular-nums`.
- Headings are weight 600–700. **Never use 800 or 900.**

**Shape and feel:**
- Radii: 4–6px on controls, 10px on cards. Avoid big pill shapes except avatars.
- Hairline borders. No glows, no radial-gradient backgrounds, no heavy shadows.
- The look should feel crisp, quiet and professional, not "gamer".
- Every interactive control is a real `<button>` or `<a>` with a touch target of at least 44px on phone.
- Never use emoji as UI icons. Use the repo's icon set or inline SVG. Emoji appear only as user content in chat and reactions.

---

## 2. App shell and league switcher

**Screens:** `Main.png`, `Mobile.png`, `MobileSwitcher.png`

### Desktop (three columns)

**1. League rail (about 64px wide).** This works the same way as Sleeper's switcher, with AF styling.
- AF home tile sits at the top. Below it is one round avatar per league the user is in. At the bottom is a dashed **+** button for creating or importing a league.
- **Ring colour** shows this week's status: green when winning, red when losing, amber when the league needs you. The **record or score** sits under the avatar in mono.
- A **platform tag** sits on the corner: `AF` in cyan for native leagues, `SLP` and others in grey for synced leagues.
- An **unread badge** sits top-right.
- Clicking an avatar switches leagues **in place** and keeps the same section. If you are on Matchup in league A, you land on Matchup in league B. Persist the last section per league.
- Hovering shows a tooltip with the league name, status and record.

**2. League nav (about 280px wide).**
- League card at the top showing the name and phase chip (SETUP, DRAFT, LIVE and so on).
- Groups:
  - **This league:** League home, My team, Matchup, Players & waivers, Trades (badge), Draft HQ, Standings & playoffs, League chat (badge), Commissioner. Commissioner is shown only to commissioners.
  - **This week:** War Room, Live scores, Season Outlook.
  - **Your record:** Your career, Rankings.
- The active item has a `p3` background and a 2px cyan inset bar on its left edge.

**3. Content area.**
- Top bar: a **Viewing [league ▾]** dropdown (also a switcher), a search box ("Find a player or jump to a league", `⌘K`), a "Live on AF" chip and the sport/week label.

### Phone

- Top: a league pill showing the avatar, name, platform tag and ▾, with ‹ › arrows to step through leagues.
- Tapping the pill opens `MobileSwitcher`, a full-screen sheet with:
  - Search.
  - Filters: All / On AF / Synced / Live.
  - Grouped sections: "Needs you" and "Live now · Wk N".
  - Rows showing ring, score, status line and unread count.
  - Footer buttons: Create league and Import league.
- Bottom nav: League, Matchup, Team, Players, Chat.
- **Chimmy lives inside Chat on phone** as a gold `#chimmy` channel. There is no separate Chimmy tab.

---

## 3. League screens

| Screen | Desktop | Phone | Key behaviour |
|---|---|---|---|
| League home | `Main.png` | `Mobile.png` | Phase stepper (Setup → Draft → Regular season → Playoffs → Offseason). The "Next up" card changes with the phase; pre-draft it shows the draft time, Enter Draft HQ, and tiles for Mock, Queue & rankings and Supplemental draft. Commissioner checklist ("Smart defaults are on", N of 6 done, DONE / NEEDS YOU). Your team card, league chat preview, standings preview and activity feed. |
| Matchup | `Matchup.png` | `MobileMatchup.png` | Score header with AF win-probability bar and projections. Chimmy insight card. Slot-by-slot rows: player, points, position pill, opponent points, game status (Final / Q3 9:14 / Sun 8:20). Week switcher. |
| My team / Lineup | `Lineup.png` | `MobileLineup.png` | Starters and bench, tap-to-swap, lock per game, injury flags, AF "optimal lineup" suggestion. |
| Players & waivers | `Waivers.png` | `MobileWaivers.png` | Search, position filters, FAAB bid sheet or rolling priority, claim queue, AF pickups. |
| Trades | `Trades.png` | `MobileTrades.png` | Incoming offer card with AF grade, give/get columns, Chimmy advice, Accept / Counter / Decline, trade block and recent trades. |
| Standings | `Standings.png` | `MobileStandings.png` | Toggle between Standings, Playoff odds and Power. A cyan rule marks the playoff line. Your row is highlighted. |
| League chat | `Chat.png` | `MobileChat.png` | See §6. |
| Commissioner | `Commissioner.png` | — | League settings, scoring, roster slots, waivers, trades review (24h), playoffs, draft settings, members and invites, plus the entry point to Tribe setup (§5.4). |

---

## 4. Draft HQ and the draft room

**Screens:** `DraftRoom.png`, `MockSetup.png`, `MockResults.png`, `DraftLive.png`, `SurvivorDraft*.png`, `SportBoards.png`, `DraftTypes.png`, `MobileDraft*.png`, `MobileMockResults.png`

### 4.1 Draft HQ hub (`DraftRoom.png`, `MobileDraft.png`)

- Entry points: Live draft, Mock draft (using this league's exact settings), Supplemental draft, Queue & rankings.
- Mock setup is in `MockSetup.png`. Mock results, with grade and roster, are in `MockResults.png` and `MobileMockResults.png`.

### 4.2 Live draft room layout (`DraftLive.png` for a 12-team league, `SurvivorDraft.png` for a 16-team Survivor league)

It is **one screen and never a long scroll.** It has three regions.

**1. Top bar**
- Back button, then the league name and format line ("16 teams · Snake · 90s · 15 rounds").
- **Clock pill:** "You're on the clock / Round 3 · Pick 11 · #43", a mono countdown and a thin progress bar. When it isn't your turn, it shows who is picking.
- Survivor only: "◆ N idols sealed".
- **Autopick** switch.
- Gear button that opens **Draft settings** (§4.5).

**2. Board** (upper half, scrolls horizontally when there are many teams)
- **Round gutter:** the round number plus a direction arrow (→ / ←), so a snake or 3rd-round-reversal board reads correctly.
- **Team headers:** avatar, name, online dot. Survivor adds the tribe name and a 2px tribe-coloured underline.
- **Cells:**
  - Dark cell with a **2px left edge in the position colour**.
  - Content: pick number (`2.06`), short name, `POS · TEAM`.
  - Your next pick cell: cyan border, "Your pick" and the countdown.
  - Badges: `RUN` (this position is on a run), `◆ IDOL` (§5, post-draft only, your own picks only), `⇄ T10 → T5` (traded pick, §4.4).
- The **AF suggested pick** is accented on the board and in the pool. Never use a loud colour fill for it.

**3. Bottom split**

**Left: player pool**
- Search box.
- Position filters with **have/need counts** under each (`RB 1/2`), plus FLEX, K and DEF.
- Toggles: Watchlist, Drafted, Rookies, AF targets.
- Columns: RK, player (headshot plus team-logo badge), **ADP** (provider ADP; the column header names the source, e.g. SLPR, ESPN, AF), **Bye** (NFL and college football; amber when it clashes with your starters), **AF Proj**, **Read** (AF signal: `AF pick`, `Value`, `Target`, `Sleeper`, `Fade`), then sport-specific stat groups (NFL: Rush yds/TD, Rec yds/TD, Pass yds/TD).
- ☆ adds to the queue. **Draft** is enabled only when you own the current pick.
- **Sorting:** the default is ADP, using a blend of provider ADP and AF ADP. Show the AF ADP in a tooltip or a secondary column.

**Right: tabbed panel**
- **Chat** (§6).
- **Queue:** drag to reorder. Autopick uses it.
- **Roster:** fills **starters first** in slot order, then bench, as picks land. Each empty slot shows what is still needed.
- **AF:**
  - "Draft next" with the reasoning (position runs over the last N picks, your roster needs, value against ADP, bye stacking).
  - **Manager draft psychology** for the managers picking before your next turn (tendencies, likely positions).
- **◆ Survivor** (Survivor leagues only, §5).

The phone versions are `MobileDraftBoard.png` (board) and `MobileDraftPool.png` (pool, plus a bottom sheet for Queue, Roster, Chat and AF).

### 4.3 Pick-order maths

```ts
// N = teams, n = 0-based overall pick index
const round = Math.floor(n / N), i = n % N;
slotOf(n) = snake ? (round % 2 === 0 ? i : N - 1 - i)
          : linear ? i
          : thirdRoundReversal ? /* rounds 0,1 snake; from round 2 flip parity */
          : …;
ownerOf(n) = traded[n]?.to ?? slotOf(n);
```

**Everything uses `ownerOf`:**
- the clock
- whether Draft is enabled
- autopick
- the roster tab
- the pick feed's "via"
- idol ownership

### 4.4 Traded picks

- Store `{ overallIndex, fromManagerId, toManagerId }` with **only the latest hop**: the previous owner and the current owner. Full history is not needed in the room.
- **Upcoming traded cell:** gold-ish border, "→ Scaries / from T8". If the pick is yours: "Your pick / from T4".
- **Made traded pick:** a small `⇄ T10 → T5` badge, with the full text in a `title` tooltip.
- **Pick feed:** "Jonathan Taylor to Open Team 5 · via T10".
- The **Draft settings** popover has a "Show traded picks" toggle.

### 4.5 Draft settings popover and round-1 reveal

**Screens:** `SurvivorDraft--settings.png`, `SurvivorDraft--round1-reveal.png`

The popover contains:
- **Round 1 pick reveal**: on/off. Length: 3s / 4s / 5s.
- Show traded picks.
- Pick sounds.
- "Preview reveal".

The setting is per league, the commissioner controls the default, and each user can mute the reveal for themselves.

**Reveal behaviour:**
- When a round-1 pick is made, every client shows an NFL-Draft-style overlay. The board is dimmed behind it.
- Overlay contents:
  - "2026 AF DRAFT · ROUND 1 · PICK 11"
  - A team line with a tribe- or team-colour bar: "WITH PICK 11 / TheCiege26 selects"
  - A big player name with headshot
  - `WR · Jacksonville · AF rank 11 · ADP 10.4`
  - A stats row and a progress bar
- Elements stagger in (rise and fade), and the bar runs for the chosen length.
- The overlay closes automatically after that length, or earlier with **Skip**.
- The reveal is triggered by the server's pick event, so all clients see it together. Queue reveals if picks land faster than the animation.
- Respect `prefers-reduced-motion` with a fade only.

### 4.6 Draft types

**Screens:** `DraftTypes.png` (desktop), `SportBoards.png` (boards for all 7 sports)

Supported types: snake, linear, 3rd-round reversal, auction, offline, auto, keeper, dynasty / devy, best ball, guillotine, **Big Brother** and **Survivor**.

- **Big Brother** is a normal draft (snake, linear, auction, offline or auto). It needs no special room.
- **Survivor** is also a normal draft format, plus hidden idols and tribes (§5).
- **Auction:** a nomination bar, bid controls and budgets per team in place of the clock.
- **Offline:** the commissioner enters picks, using the same pick path.
- **Auto:** the server picks from queue, then AF.
- **Board columns per sport:** NFL, NCAAF, NBA, NCAAB, MLB, NHL and soccer. Use each sport's position colours and stat columns (see `SportBoards.png`). Bye weeks appear only for NFL and NCAAF.

---

## 5. Survivor: tribes and hidden idols

**Screens:**
- `SurvivorDraft.png`
- `SurvivorDraft--survivor-tab.png`
- `SurvivorDraft--end-of-draft.png`
- `MobileSurvivor.png`
- `TribeSetup.png`

### 5.1 Rules (from Guap)

- Each league has **6 to 8 idols**. Each idol is hidden on a player who is **expected to be drafted**: pick from players whose ADP is within league size × rounds, with a buffer.
- The manager who drafts that player **owns the idol**. The idol belongs to the manager, not the player, so later trading or dropping the player does not move the idol.
- **Nobody learns anything during the draft.** The owner finds out **only after the last pick, by DM** from "AF Host".
- **Idol types:**
  - Immunity idol (self)
  - Tribe immunity
  - Steal 3 players (from any team)
  - Point surge
  - Vote steal
  - Lineup lock
  - Guap will supply more types later. Make the type an enum or table so new types can be added without code changes.
- **Tribes** are set **before** the draft, usually 4 tribes of 4–6 managers. The draft order is still random, but the room **shows tribe membership** so managers know their tribemates.

### 5.2 Secrecy model (must-have, server side)

1. **Assign at draft lock** (when the commissioner starts the draft or the order is locked), on the server only, using a cryptographically secure RNG.
2. Store the assignments in a **separate table that clients can never read**. In Supabase, that means row-level security (RLS) denies all reads, and only the service role can read it.
3. At lock, store a **seal hash**: SHA-256 of the canonical idol list plus a server salt. Show the seal to the commissioner, which proves nothing changed mid-draft.
4. **On each pick**, the same server transaction that records the pick checks the hidden table and writes an `idol_owner` row when there is a match. **Do not emit any event, toast, count change or timing difference to clients.**
5. **Public data shows a constant count** ("◆ 7 idols sealed") for the whole draft. It must never go down as idols are found, because that would leak who found one.
6. **AF recommendations, ADP, "Read" tags and autopick must never use idol locations.** Keep the hidden table out of every recommendation query.
7. **After the final pick**, a job sends a DM to each owner: "You drafted 1 hidden idol: Immunity idol (with Ladd McConkey). Nobody else knows." Only then does the owner's own board show `◆ IDOL` on their own cells. Other managers never see it.
8. Auto, offline and commissioner-entered picks all go through the **same pick function**, so idol resolution cannot be bypassed.
9. Commissioner view: the commissioner sees the seal and the count, **not the locations**, unless the commissioner also opts out of playing.

### 5.3 Survivor tab in the room (`SurvivorDraft--survivor-tab.png`)

- **Board view:** All / Spotlight (dims non-tribemates) / "[My tribe] only".
- A tribe list with colour, members and a "Your tribe" tag.
- A sealed-idols card showing the count and the seal.
- After the draft, the AF Host DM card (`SurvivorDraft--end-of-draft.png`).
- Chat gets a **Tribe [name]** channel during the draft if the commissioner enabled it.

### 5.4 Tribe setup for the commissioner (`TribeSetup.png`)

- Number of tribes: 2–6.
- Assign by **Random** (seeded, re-rollable), **Balanced by AF** (snake by AF power), or **Manual** (move a manager to another tribe).
- Per tribe: a name input, colour swatches and an AF strength bar.
- **Validation:** every tribe must have 4–6 managers. "Lock tribes & announce" stays disabled until the setup is valid.
- Toggles: show tribes on board, tribe chat during draft, announce tribes in league chat.

---

## 6. Chat (league and draft room)

**Screens:** `Chat.png`, `MobileChat.png`, and the Chat tab in `SurvivorDraft.png` and `DraftLive.png`

- **Channels:**
  - League rooms: general, trash-talk, trades, waivers, plus **Chimmy** (AF assistant, gold).
  - In the draft room: Draft room, League, Tribe [name] (Survivor), Chimmy.
- **Pick feed rows** inline in the draft chat: `3.07 · QB · Joe Burrow to Open Team 8 · via T10 · 9:39`.
- **@mentions:**
  - Typing `@` opens a picker of managers, plus `@chimmy`.
  - Mentions render as cyan links and notify the person mentioned.
  - Multi-word names must work. See `01_AT_MENTIONS_SYSTEM.md`.
- **Emoji picker** and **reactions** (with counts) on messages.
- **GIFs:** a picker with search. **This needs a GIPHY or Tenor (or Klipy) API key via env.** The key must never be sent to the client; proxy the requests.
- **Polls:** create with a question and 2–4 options. Show thin result bars with a percentage, one vote per user, changeable until the poll closes.
- **Other features:** reply/quote, pinned messages, typing indicator, unread badges, system cards (waivers, trades, the pick feed).
- **Chimmy:**
  - On desktop it is a direct thread, and it can also be summoned with `@chimmy` in any channel.
  - On phone it is the gold `#chimmy` channel inside Chat.
  - Replies are tinted cyan.

---

## 7. Data and API surface (suggested; reconcile with the existing schema)

- `draft_pick { draft_id, overall_index, round, slot, owner_manager_id, player_id, made_at, source: user|auto|offline|commish }`
- `draft_pick_trade { draft_id, overall_index, from_manager_id, to_manager_id, updated_at }`. Store the latest hop only.
- `draft_settings { reveal_round1: bool, reveal_seconds: 3|4|5, show_traded: bool, sounds: bool, … }`
- `survivor_tribe { league_id, name, color, sort }` and `survivor_tribe_member { tribe_id, manager_id }`
- `survivor_idol_hidden { draft_id, player_id, idol_type }`. **RLS denies all reads; service role only.**
- `survivor_idol_seal { draft_id, sha256, idol_count, sealed_at }`
- `survivor_idol_owner { league_id, manager_id, idol_type, source_player_id, found_pick, notified_at, used_at }`. Owners can read only their own rows, and only after `draft.completed_at`.
- `adp_blend` view: provider ADP plus AF ADP. The pool reads from this view.
- Realtime channels: picks, clock, chat. The reveal event is derived from pick events where `round = 1`.

---

## 8. Images and licensing

- Player headshots and team logos in the mockups are initials and placeholders. Use **licensed provider images** (whatever source the repo already has rights to). Fall back to initials when an image is missing.
- Never hotlink images from Sleeper, ESPN or similar sources.

---

## 9. Build order

1. **Tokens and shell:** league rail switcher, nav, top bar, phone bottom nav and switcher sheet. → `Main`, `Mobile`, `MobileSwitcher`
2. **League screens:** home, matchup, lineup, waivers, trades, standings (desktop and phone).
3. **Chat:** channels, mentions, emoji, reactions, polls, GIF proxy, Chimmy channel.
4. **Draft room core:** board, pool (ADP blend, bye weeks, AF Read), queue, roster fill, AF tab, autopick, traded picks, Draft HQ hub, mock setup and results.
5. **Draft settings and round-1 reveal.**
6. **Survivor:** tribe setup, room tribe view, server-side idol assignment, seal and resolution, post-draft DM. Add **tests that prove nothing leaks**:
   - The public API never returns idol data during the draft.
   - The count stays constant.
   - Recommendation queries never join the hidden table.
7. **Draft types and sports:** auction, offline, auto, 3rd-round reversal, and boards for all 7 sports.

**Definition of done for each screen:**
- A Playwright screenshot at 1440 and 390 visually matches the PNG (same layout, tokens and hierarchy).
- No console errors.
- Keyboard and touch work.
- No secrets appear in logs.

---

## 10. Screen index

| PNG | What it shows |
|---|---|
| `Main.png` / `Mobile.png` | League home, desktop and phone |
| `MobileSwitcher.png` | Phone league switcher sheet |
| `Matchup.png` / `MobileMatchup.png` | Matchup |
| `Lineup.png` / `MobileLineup.png` | My team / lineup |
| `Waivers.png` / `MobileWaivers.png` | Players & waivers |
| `Trades.png` / `MobileTrades.png` | Trades |
| `Standings.png` / `MobileStandings.png` | Standings, odds and power |
| `Chat.png` / `MobileChat.png` | League chat with Chimmy |
| `Commissioner.png` | Commissioner center |
| `DraftRoom.png` / `MobileDraft.png` | Draft HQ hub |
| `MockSetup.png` | Mock draft setup |
| `MockResults.png` / `MobileMockResults.png` | Mock results and grade |
| `DraftLive.png` | Live draft room, 12-team regular league |
| `MobileDraftBoard.png` / `MobileDraftPool.png` | Phone draft board and pool |
| `SportBoards.png` | Draft boards for all 7 sports |
| `DraftTypes.png` | Draft type gallery (snake, linear, 3RR, auction, offline, auto, keeper, dynasty/devy, best ball, guillotine, Big Brother, Survivor) |
| `SurvivorDraft.png` | Survivor live room (16 teams, 4 tribes) |
| `SurvivorDraft--settings.png` | Draft settings popover |
| `SurvivorDraft--round1-reveal.png` | Round-1 pick reveal overlay |
| `SurvivorDraft--survivor-tab.png` | Survivor tab: tribes and sealed idols |
| `SurvivorDraft--end-of-draft.png` | Post-draft: AF Host idol DM, ◆ IDOL on own pick |
| `SurvivorDraft--queue-tab.png` / `--roster-tab.png` / `--af-tab.png` | Other right-panel tabs |
| `MobileSurvivor.png` | Phone: AF Host idol DM |
| `TribeSetup.png` | Commissioner tribe setup |

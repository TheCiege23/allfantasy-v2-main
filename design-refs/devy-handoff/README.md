# Handoff: Devy (College Prospects)

## Overview
Two new screens for AllFantasy's dynasty product covering "devy" (college/dynasty-eligible prospect) content:
1. **Devy Core** — the cross-league devy hub a user sees from the main app (Core), showing prospects across every league they're in.
2. **Devy League Tab** — a per-league "Devy" tab, shown when a specific connected league has devy roster slots enabled, scoped to that league's roster/draft/trades.

## About the Design Files
The files in this bundle (`AF Devy Core.dc.html`, `AF Devy League Tab.dc.html`) are **design references built in HTML** — they show intended layout, content, states and interaction, not production code to copy directly. The task is to recreate these designs in the target codebase's existing environment (React, Vue, native, etc.), using its established components, data layer and design system — not to ship the HTML files as-is.

## Fidelity
**High-fidelity.** Colors, typography, spacing and copy are final/representative of the AllFantasy dark UI system. Player names, stats and news items are placeholder/fictional data standing in for real feed data — the layout and data shape are what should carry over.

## Screens / Views

### 1. Devy Core (`AF Devy Core.dc.html`)
**Purpose:** Cross-league devy hub. Central place to browse/rank/watch college prospects independent of any one league.
**Layout:** Single-column scroll, max-width 1200px centered container, 40px top padding, 22px gap between sections. Header row: title block (left) + a 3-way "Populated / Empty / Loading" state switcher (right, for QA/demo only — not a real product control).

Sections, top to bottom:
- **Top Devy Prospects** (hero): ranked list of 5 rich player cards. Each card: rank number, 64px circular headshot with a 24px team-color badge overlaid bottom-right, name + position + school + class year, a trend indicator (↑/↓/— with color), 3 stat values + a numeric "grade" (0–100, color-coded: ≥93 green/"good", ≥88 cyan/"accent", else neutral), and a one-line scouting blurb.
- **Cross-League Exposure**: table — Player, Leagues rostered in (e.g. "4 of 6"), Platforms (comma list), Exposure % (highlighted cyan).
- **Rankings by Position**: 4 filter chips (QB/RB/WR/TE), active chip highlighted cyan; below, a top-3 list for the selected position (rank, name, school, class year, grade).
- **Your Watchlist**: 2-column grid of followed-player rows (avatar, name, position/school, "Following" pill).
- **Browse by College**: 4-column grid of college tiles — team-color badge, school name, conference, count of tracked prospects.
- **Devy News**: feed rows with a colored tag (BREAKOUT=green, INJURY=red, COMBINE=amber, TRANSFER=cyan), player name, one-line blurb, relative timestamp. Footer disclaimer text below the feed.

**States:** Populated (all sections as above) / Empty (single centered card: "No devy data yet" + "Connect a league" CTA) / Loading (single centered card: spinner + skeleton bars). All three replace the entire section stack below the header — sections aren't gated individually.

### 2. Devy League Tab (`AF Devy League Tab.dc.html`)
**Purpose:** Devy content scoped to one already-connected league (shown as a tab within that league's nav, alongside My Team/Matchup/Waivers/etc).
**Layout:** Same shell/pattern as Devy Core (max-width 1200px, single scroll, same header + state switcher pattern, breadcrumb reads "{League Name} · DEVY").

Sections, top to bottom:
- **Your Devy Slots** (hero): 3-column grid of this league's devy bench slots. Filled slot = mini player card (avatar + team badge, name, position/school). Empty slot = dashed-border placeholder, "Empty devy slot".
- **Available Devy Free Agents**: list rows (avatar, name, position/school/grade, cyan "Add" button) — players not yet rostered by anyone in this league.
- **Devy Draft Board · Round 1**: 4-column grid of pick cards (pick label e.g. "R1 · P2", team name, status: "drafted"/"On the clock" (highlighted cyan)/"Upcoming"). Header row shows a countdown ("Pick due in 18h").
- **Devy News · This League**: same news-row pattern as Core, but each row also carries an ownership tag ("ROSTERED · YOU" / "FREE AGENT") and is filtered to players relevant to this league only.
- **Devy Trade Values**: table — Player, Value (numeric points), Trend (↑/↓/— color-coded), Status (rostered-by / free agent). Footer disclaimer.

**States:** Populated / Empty ("This league hasn't turned on devy slots" + "Enable in league settings" CTA, commissioner-gated) / Loading (same spinner+skeleton pattern as Core).

## Interactions & Behavior
- State switcher pills (top-right): click to swap Populated/Empty/Loading — demo-only, remove before ship or replace with automatic state driven by real data-fetch status.
- Position filter chips on Devy Core: click sets active position, re-renders the top-3 list below. Pure client-side filter over already-loaded position rankings data.
- "Add" buttons on free-agent rows and the league CTA buttons are unwired in the mock — implement as real actions (roster add, navigate to league settings) in the target app.
- No hover/focus states beyond `cursor:pointer` on clickable rows/buttons in the mock; apply the codebase's standard interactive states (hover, focus-visible, active) when implementing.
- Loading state uses a simple CSS spin animation (`@keyframes spin`, 0.9s linear infinite) — respect `prefers-reduced-motion` in the real implementation.

## State Management
Suggested state shape per screen:
- `viewState: 'loading' | 'empty' | 'populated'` — driven by real fetch status, not manual toggle.
- Devy Core: `activePosition: 'QB' | 'RB' | 'WR' | 'TE'` for the rankings filter.
- Data needed: prospect list (rank, name, position, school, class year, stats, grade, trend, team colors/logo), cross-league exposure per player, per-position ranking lists, user's watchlist, college directory with counts, news feed items.
- Devy League Tab additionally needs: this league's devy slot config (total slots, filled/empty, occupant), free-agent pool scoped to league, this league's devy draft board/pick order, trade-value table scoped to rostered/available players in this league.

## Design Tokens
Dark theme, shared with the rest of the AllFantasy Core product:
- `--bg:#06070f` `--surface:#0d1020` `--surface2:#0a0c1a`
- `--line:rgba(255,255,255,.07)` `--line2:rgba(255,255,255,.14)`
- `--text:#eef0fa` `--text2:#c3c9e6` `--muted:#8f97bd` `--faint:#5d648a`
- `--accent:#22d3ee` (cyan) `--accent-ink:#04050c` `--accent-soft:rgba(34,211,238,.09)` `--accent-line:rgba(34,211,238,.3)`
- `--good:#34d399` (green) `--warn:#fbbf24` (amber) `--bad:#fb5b78` (red), each with a `-soft` background variant at ~10% opacity
- `--chip:rgba(255,255,255,.05)` `--chip-line:rgba(255,255,255,.1)` for pill/segmented backgrounds
- Fonts: **Archivo** (400/500/600/700/800/900) for UI text and headings, **JetBrains Mono** (500/700/800/900) for labels, stats, numbers and monospace-style tags. Section eyebrow labels: 9px JetBrains Mono, 700 weight, `.14em` letter-spacing, `--faint` color, uppercase.
- Border radius: 12–14px for cards, 7–9px for pills/buttons/chips, 50% for avatars/badges.
- College team colors (placeholder set used in mock): Ohio State `#BB0000`, Texas `#BF5700`, Georgia `#BA0C2F`, Oregon `#154733`/`#FEE123`, Colorado `#CFB87C`, LSU `#461D7C`/`#FDD023`, Alabama `#9E1B32`, Michigan `#00274C`/`#FFCB05`.

## Assets
- Player headshots and team logo badges are `<image-slot>` placeholders (drag-and-drop image slots in the design tool) — swap for real player headshot/team logo URLs from the data feed in the real implementation. `image-slot.js` is included for reference only; the target codebase should use its own image component.
- No other custom icons/illustrations — all indicators (trend arrows, tags, badges) are styled text/color, not icon assets.

## Files
- `AF Devy Core.dc.html` — Devy Core hub design
- `AF Devy League Tab.dc.html` — per-league Devy tab design
- `image-slot.js` — placeholder image-slot component referenced by both files (design-tool only, not for production use)

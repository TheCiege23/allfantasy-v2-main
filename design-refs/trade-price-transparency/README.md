# Handoff: Trade Pricing Transparency & Notifications

## Overview
Shows how a single priced trade surfaces across every context it appears in: the cross-league dashboard, a single league's Trades tab, a push notification, and an email. The core idea carried through all of them: every asset's value is traceable to the input that produced it (projection, market fallback, IDP scarcity, draft-pick placement, FAAB amount), unpriced assets render as an explanatory sentence rather than a bare `0`, and format-specific modifiers (Guillotine survival odds, taxi-squad exemptions) show as a separate adjustment layer next to — never blended into — the base price.

## About the Design Files
The file in `design_files/` is an **HTML design reference** (a lightweight internal templating runtime, not React/production code) — it shows intended look, content, and interaction, not code to copy directly. Recreate it in the target codebase's real stack using its existing components and data layer. Do not ship the HTML.

## Fidelity
**High-fidelity** for layout, type, spacing, color, and copy structure. Manager/team names ("Casey · Dynasty Dogs," etc.), leagues, and dollar figures are placeholder data — wire to real trade/roster data. Player and league-logo photo slots are placeholders (flat colored chips with initials in this file) — swap for real headshots/logos in the real build.

## Screens (one file, six labeled frames)

### 1. Dashboard — all pending trades (desktop + mobile)
Cross-league feed: every pending trade across all connected leagues, each row tagged with its platform (Sleeper/Yahoo/ESPN badge) and league name. One trade is shown expanded as the reference example:
- **Compact proposal card**: a chat/feed-style notification ("`@user` proposed a trade in `[league]`") with per-asset rows (avatar, name, position/team, value) — borrows the compact feed pattern common to fantasy platforms, but adds the fairness score + one-line pricing-source note those platforms don't show.
- **Expanded breakdown**: two-column "X sends / Y sends" layout. Each asset row = colored type badge + name + value, with a sub-line naming the exact pricing source (`PROJECTION`, `MARKET`, `IDP SCARCITY`, `DRAFT PICK`, `FAAB`) and a one-sentence explanation of what that source means.
- **Decision OS panel**: wins-now / wins-long-term pair, a plain-language read on why the deal fits each side, "Ask Chimmy about this trade" and "View in [league]" actions.
- Collapsed rows below for the other pending trades, each showing fairness score and a flag chip when relevant (unpriced asset, Guillotine survival adjustment).

### 2. League tab — this league's trades only (desktop + mobile)
Same breakdown pattern, scoped to one league (no platform badges — redundant once you're inside a league). Adds what only makes sense in-league:
- **Accept / Counter / Decline** actions directly on the expanded trade.
- **Trade History & Grades**: once a trade settles, each side gets a letter grade based on how the assets actually performed vs. projection, plus a one-line reason. Explicitly scoped to be visible only to the two managers in that trade, and does **not** appear on the dashboard.

### 3. Push notification
Lock-screen style: app icon, headline, one-line summary naming both sides' assets and the fairness score, plus a secondary "window closing" reminder notification.

### 4. Email notification
Same trade as a two-column "X gets / Y gets" email card, fairness score + pricing-source line, a compact Decision OS callout, primary/secondary CTAs ("Open the trade in AllFantasy" / "See the league"), and a standard alerts-preferences footer.

## Pricing model reference (drives all copy in this file)
Each asset's value must resolve through exactly one of these, and the UI must say which:
1. **Projection** — rest-of-season AllFantasy projection, scaled for that league's positional scarcity.
2. **Market** — fallback when no projection exists; raw market price for the player.
3. **IDP scarcity** — computed against the league's own defensive starting slots/scoring when no market exists for defenders.
4. **Draft pick** — priced from where the pick actually falls in that league, not its round number.
5. **FAAB** — priced from the bid amount itself.
6. **Not priced** — no projection, market, or defensive value reached the engine. Renders as a sentence ("no signal reached the engine... this is a data gap, not a value judgement"), never a bare `0`.

Format modifiers layer on top of a priced base and always show as their own line with a signed `%` adjustment, never folded into the base number:
- **Guillotine** survival odds (e.g. "10 of 18 teams left... worth roughly 53% of week one").
- **Taxi-squad / bench-cost exemptions** (e.g. "taxi-eligible on a 10-slot taxi squad — holding him costs nothing").

Any trade with at least one unpriced asset shows a standing amber banner: totals are incomplete, and that's missing data, not a verdict.

## Design Tokens
- `--bg:#06070f` `--surface:#0d1020` `--surface2:#0a0c1a`
- `--line:rgba(255,255,255,.07)` `--line2:rgba(255,255,255,.14)`
- `--text:#eef0fa` `--text2:#c3c9e6` `--muted:#8f97bd` `--faint:#5d648a`
- `--accent:#22d3ee` (fairness/projection) `--good:#34d399` (pick/positive grades) `--warn:#fbbf24` (FAAB/caution) `--bad:#fb5b78` (unpriced/negative) `--violet:#a78bfa` (market) `--orange:#fb923c` (IDP scarcity)
- Platform chips: Sleeper `bg rgba(226,66,66,.16) / fg #f28b8b`, Yahoo `bg rgba(124,58,237,.16) / fg #b79bfa`, ESPN `bg rgba(217,41,41,.16) / fg #f28080`
- Typography: Archivo (400–900) for UI text/headlines; JetBrains Mono (500–900) for labels, mono numerals, eyebrows — both Google Fonts.
- Radii: 6–9px chips/badges, 10–14px inner rows, 14–18px outer cards, 32px phone frame.

## Assets
Player headshots, team logos, league logos, and manager avatars are represented as flat colored placeholder chips (initials) in this file — pending real photo/logo assets. Swap in real images at build time; sizes are documented per-instance in the file (headshot slots sit at 28–48px depending on context).

## Files
- `design_files/AF Trade Price Transparency.dc.html` — design source, all six frames
- `screenshots/dashboard-desktop.png`, `dashboard-mobile.png`
- `screenshots/league-desktop.png`, `league-mobile.png`
- `screenshots/push-notification.png`
- `screenshots/email-notification.png`

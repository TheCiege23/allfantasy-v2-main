# Handoff: Trade Center (visual upgrade)

## Overview
Three versions of the Trade Center, sharing one visual system:
1. **Core** (`Main.dc.html`) — the cross-league Trade Center a manager reaches from `/core/trades`. Shows offers waiting across every connected league and platform, then the builder, verdict, context and Decision OS for the league in focus.
2. **Mobile** (`Mobile.dc.html`) — the same page at 390px, with the action row stuck above the real `/core` phone tab bar.
3. **League** (`League.dc.html`) — the Trades tab inside one league: what needs the viewer's action, the viewer's own trades, every trade done in the league with both sides' grades, and the trade block.

## About the design files
These are **design references built in HTML**. They show intended layout, content, states and interaction — not production code to copy. Recreate them with the codebase's existing components, data layer and stylesheets: `components/core-app/screens/TradeCenter.tsx` + `af-trade-center.css` for Core and Mobile, `app/league/[leagueId]/tabs/TradesTab.tsx` for League.

## Fidelity
**High-fidelity.** Colors, type, spacing and copy are final/representative of the AllFantasy dark Core system. Player names, values and records are placeholder data standing in for the real feeds — the layout and data shape are what carry over.

## What changed from the previous Trade Center design
- **The verdict is the hero.** Grade tiles for each side sit beside a 40px fairness score, over a two-ended balance track ("favours you · even · favours them"). Confidence and "what we couldn't see" read directly beneath it. The no-signal callout (a C that means "no data") and the SUPPRESSED chip (format-blocked) keep their places.
- **A value-balance rail under the builder.** You send / you get totals as a proportional bar, with the delta and % apart. Uses `giveTotal` / `getTotal` / `percentDiff` the analyzer already returns. Unpriced assets are excluded and the rail says so ("2 unpriced").
- **Offers across your leagues** (Core only). One tile per connected league with a platform mark and an honest status: *1 offer waiting*, *Nothing waiting*, or *Not read* for platforms whose pending offers we do not ingest (per `/api/league/trades-panel`'s `pending.scanned`). The league in focus is highlighted.
- **Platform marks everywhere a league is named**, using the core `--p-*` tokens (Sleeper / ESPN / Yahoo / Fantrax / MFL).
- **Position colour on the position token** in every asset row and on trade-block card borders, using the accents `TradesTab.tsx` already assigns (QB pink, RB emerald, WR sky, TE orange, DL amber, LB lime, DB indigo, K yellow). Asset-type glyphs keep the app's own vocabulary (P / D / $ / I / W / S).
- **Section eyebrows with rule lines** so the long page scans; a "Trading with" chip row with records; per-asset tags rendered as small pills (QUESTIONABLE, UNPRICED, DOESN'T EXIST HERE).
- **The asset legend is league-aware.** "Asset types in this league" lists only what the format allows (dynasty: player, pick, FAAB; redraft: player, FAAB — no picks, which is why the redraft deal is blocked; zombie: player, weapon, serum, pick). Today's `ASSET_TYPES` constant shows all six everywhere; drive it from the league's format instead.
- **Mobile**: no fake status bar or phone bezel — the phone draws its own chrome. The action row sticks above the `/core` tab bar; chip rows scroll instead of wrapping; every tap target clears 44px.

## Screens / views

### 1. Core (`Main.dc.html`) — 1440 × 3080
Same shell as the other Core handoffs: max-width 1200px, 40px top padding, 22px section gap. Header: eyebrow "CORE · TRADES", 34px title, lede; a 5-way PREVIEW STATE switcher (right) for review only.

Sections, top to bottom:
- **Offers across your leagues**: horizontal strip of 224px league tiles (platform mark, league name, format/teams, status line). Active league(s) highlighted with `--accent-soft` / `--accent-line`.
- **League context bar**: platform mark, name, format, opponent chip, deadline chip (amber).
- **Asset types supported**: six pills.
- **Format banner** (state: Format blocked) or **Linked deal banner** (state: Cross-platform).
- **Trading with**: chips with records; active chip in accent. Hidden for multi-team and cross-platform.
- **Builder**: one card per team (2–4), each with SENDS rows (type glyph, name, position token in position colour, sub, value or —, remove ×, optional tag pill, optional → destination for 3-way). "+ Add asset", total with "n unpriced". Cross-platform renders two leg cards (platform mark, league, "change league").
- **Value balance** rail (two-team states only).
- **The verdict** (accent border): grade tiles, score /100, fairness label, confidence, balance track, no-signal callout, "what we couldn't see".
- **Context notes** grid (3 columns): FORMAT, LEAGUE & ROSTER SHAPE, WHERE EACH SIDE STANDS, WHAT THESE PICKS REALLY ARE, YOUR LEVERAGE, WHAT IT'S WORTH TO YOU, BYE-WEEK COLLISIONS — only groups with content render.
- **Decision OS · this deal**: why, wins now / long term, contender and rebuilder reads, warnings, rebalance ideas, counter targets.
- **Propose** (accent border): one button whose label and note change by state (Sleeper: "the partner still accepts there"; ESPN: "not posted from here yet"; 3-way: "all three managers accept"; linked: "Pair both legs").
- **Decision OS · Trade Finder**: three partner cards (team, record, fit tag, get-for-give, values, checkable rationale).
- **Actions**: caption + Analyze this trade / Save draft / Ask Chimmy to explain.

**States**: Analyzed · Degraded data · Format blocked · Multi-team · Cross-platform. ⚠ In the product these are organic — do not reimplement the switcher. Multi-team and cross-platform still have no backing schema (see the note in `TradeCenter.tsx`); the designs show what they would look like when they do.

### 2. Mobile (`Mobile.dc.html`) — 390 × 844
Fixed-height frame: header (eyebrow, 26px title, compact A/D/B/M/X switcher), scrolling body, sticky action row (Analyze · Save · Chimmy icon, all 44px), then the `/core` tab bar (Home · My team · Matchup · Trades · Waivers · More; Trades active). Body order matches Core with these differences: offers strip, legend and partner chips scroll horizontally (bleed to the edges); grade tiles show YOU / partner name in a compact row; note groups stack; finder cards scroll horizontally.

**Offers waiting on you** sits between the legend and the builder — where the real page's inbox lives — and renders the **pending trade card** (see the League section for its anatomy and required states) at phone size: single column, 30px asset avatars, 44px asset rows, full-width 44px action buttons, "Open in Trade Center →" centred beneath. The other preview states show the honest lines instead of cards: "Nothing waiting on you in {league}" for a league that was read, "Not read — ESPN offers aren't ingested yet" for one that was not, and a note that a linked deal is paired rather than offered.

### 3. League (`League.dc.html`) — 1440 × 2140
Header: eyebrow "{LEAGUE NAME} · TRADES", title, lede; a Populated / Empty / Loading switcher.
- **League context bar**: platform mark, name, format, season counts ("7 completed · 3 pending · 1 vetoed"), review-policy chip (violet, from `commissionerTradeReviewType` + `tradeReviewHours`), deadline chip.
- **Needs your action** (3-column grid of **pending trade cards**, below). Card kinds: *Offer to you* (Accept / Reject), *On Sleeper · read-only* ("Act on it in Sleeper" / Load into builder — Sleeper has no write API), *Commissioner review* (Approve / Veto), *Your offer* (Cancel offer).
- **Your trades**: Active / Completed tabs. **Active** is a 2-column grid of the same pending trade cards. **Completed** rows: DONE pill + when, YOU SEND, YOU GET · PARTNER, your **realized** grade tile with note, status chip; a withheld grade renders "—" with the reason (FAAB only, pick unpriced).

#### The pending trade card
Reads like the provider's own proposal card, with the AllFantasy read layered on top:
- **Header**: swap glyph, headline ("Cold Takes FC has proposed a trade" / "You proposed a trade to …"), when + expiry line, role chip at right.
- **Manager blocks, proposer first**: initials avatar, name, YOU pill, "SENDS", then — only once the read is in — that side's projected grade tile and total. Under it, one row per asset: 32px avatar (player headshot; a `PICK` badge for picks; a `$` badge for FAAB), name, mono meta line (`RB - ATL`, `FAAB`), market value at right (— when the feed cannot price it; picks and FAAB show — per line, their value is in the side total).
- **AF READ strip** (accent-soft box): fairness label, score `/100`, confidence. States the card must have: *ok* (as above), *pricing* ("Pricing this deal…", no values or grades anywhere), *failed* ("Couldn't price this one just now — the offer above is exactly as proposed"), *degraded* (no-signal warning in `#ffd7de`), and *short* ("Priced without X — could not be read as a pick or player"). The offer always renders exactly as proposed; the read never invents a value.
- **Footer**: the role's actions at left, "Open in Trade Center →" at right.
- Data: `/api/league/trades-panel` for the offer (structured `pendingOffers` for provider trades; display strings for native ones, parsed back into the analyzer's vocabulary — a label that does not parse is dropped and named), `/api/trade-value/analyze` for the read, one call per open offer, capped.
- **League trade log**: every trade this season. Filter chips All / Completed / Pending / Vetoed and an "Only mine" toggle. Columns: week, Side A sends, Side B sends (YOU pill on the viewer's side, row tinted `rgba(34,211,238,.035)`), grades A · B (letter tiles or — with why), status chip (PENDING / PENDING · ON SLEEPER / COMMISSIONER REVIEW / COMPLETED / VETOED / DECLINED).
- **Trade block**: 6-column grid of cards with a 2px position-colour border, initials avatar, name, owner, value, watch heart (toggles, persisted per league as today).
- **Actions**: caption + Build a trade / Find a partner.

**States**: Populated / Empty ("No trades in this league yet" + Build a trade / Find a partner) / Loading (spinner + skeleton).

## Interactions & behaviour (in the mock)
- State switchers: review only.
- Core/Mobile: "+ Add asset" appends the next queued asset type; × removes; "+ Add another team" (to 4); cross-platform "change league" cycles a leg's league; "+ Add another linked leg" (to 3). Partner chips toggle.
- League: Your-trades tabs, log filter chips, "Only mine" toggle and watch hearts are live. Accept / Reject / Approve / Veto are unwired — wire to the existing `/api/leagues/{id}/trades/{tradeId}/{accept|reject|cancel|commissioner}` routes.
- No hover/focus states beyond `cursor:pointer`; apply the codebase's standard interactive states.

## State management
- Core: `view` is organic (analyzed / degraded / blocked / multi / cross) from the analyzer result — `blocked` when `formatNotes` say the deal cannot happen, `degraded` when `result.degraded` or nothing priced. `partnerRosterId`, `giveAssets`, `getAssets` as today. New: `leagueTiles` from a cross-league read of `/api/league/trades-panel` (`pending.scanned`, `pendingOffers.length`) per connected league.
- League: `activeTrades` + `history` from `/api/league/trades-panel` and `lib/core-app/trades.ts` (`GradedTrade.letter | withheldReason`), `tradeBlock`, `yourTab`, `filter`, `onlyMine`, `watch`.

## Design tokens
Dark theme, shared with the rest of AllFantasy Core (`components/core-app/af-core.css`):
- `--bg:#06070f` `--surface:#0d1020` `--surface2:#0a0c1a` `--line:rgba(255,255,255,.07)` `--line2:rgba(255,255,255,.13)`
- `--text:#eef0fa` `--text2:#c3c9e6` `--muted:#8f97bd` `--faint:#5d648a`
- `--accent:#22d3ee` `--accent-ink:#04050c` `--accent-soft:rgba(34,211,238,.09)` `--accent-line:rgba(34,211,238,.3)`
- `--good:#34d399` `--warn:#fbbf24` `--bad:#fb5b78` `--violet:#a78bfa` `--orange:#fb923c`
- Platform marks: sleeper `#1f2a4d/#9fd4ff` · espn `#4a1414/#ffb4b4` · yahoo `#3a1d55/#dcb4ff` · fantrax `#123a2c/#6fe3ad` · mfl `#3a2410/#f0b46a`
- Grade letters: A `#34d399` B `#5eead4` C `#fbbf24` D `#fb923c` F `#fb5b78`, on a 12%-tint tile with a 30% border; withheld = `—` on `--faint`.
- Fonts: **Archivo** for UI text and headings, **JetBrains Mono** for labels, numbers, chips. Eyebrows: 10px mono 700, `.12em`, uppercase, `--faint`.
- Radii: 13–16px cards, 9–10px rows/buttons, 5–7px chips, 999px legend pills.

## Files
- `Main.dc.html` — Core (cross-league)
- `Mobile.dc.html` — Mobile
- `League.dc.html` — League tab
- `canvas.json` — canvas layout for the three artboards

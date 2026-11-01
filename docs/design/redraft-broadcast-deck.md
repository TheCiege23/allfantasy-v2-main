# Redraft broadcast deck (batch A3)

Decision OS, Live Intel, Legacy and the Commissioner tab of `/league/[id]`, in the redraft identity
([`redraft-identity.md`](./redraft-identity.md)). Native redraft leagues only; every other league renders
as before.

## Gates — two, and they agree

- **TSX:** `useRedraftDeck(league)` (`components/decide/redraftDeck.tsx`) → `resolveRedraftIdentity`. A
  deck root in a redraft league carries `data-rd-deck="<sport>"`.
- **CSS:** `components/decide/redraft-deck.css`, every selector under
  `.nl-workspace[data-format=redraft][data-sport]`. `broadcast-deck.css` is shared with /core's Waivers
  embed and every non-redraft league; it only gained the `--bdx-me` token (same `#ff9d5c`).
  `__tests__/league-media/redraftDeckCss.test.ts` fails on a selector outside the scope, a colour
  literal, a nested at-rule or a font size under 11px.

## What changed per tab

| tab | change | drops without data |
|---|---|---|
| Decision OS | `--bdx-*` re-pointed at /core's palette + `--rd-*` (light mode stops being a navy slab); upright display type, mono labels, accent KPI caps, token severity chips, solid verdict colours | the deck's own rules (Sleeper-only Matchup Center / Trade finder / Waiver intel render nothing for a native league, as before) |
| Live Intel | same tokens; a native redraft league with no Sleeper drafts gets "This league drafts on AllFantasy" + **Open Draft HQ** instead of "link a Sleeper account" | — |
| Legacy | same tokens; the "History for allfantasy leagues isn't synced yet" state becomes a true statement plus **Open standings** | — |
| Commissioner | sport accent restored (the tab's own `.af-core` root reset `--accent` to cyan); header chip; the league-health panel below | see below |

## Commissioner league health (approved Commish mock)

`components/decide/RedraftCommishHealth.tsx`, mappings in `lib/league-media/redraftDeck.ts`.

| part | source | dropped when |
|---|---|---|
| score ring, status, "N of M managers active", confidence | `GET /api/commissioner/leagues/[id]/health-summary` → `getCommissionerHubHealthForUser` + `resolveHubHealthScore` (the /core hub's number) | snapshot withheld → ring shows "—" and the resolver's reason |
| trend line | `history` — **nothing stores past scores today**, so it is always empty | fewer than two past scores (always, for now) |
| sub-score bars | engagement (Activity), participation, fairness, sustainability | a sub-score is null (participation, often) |
| this week's checklist | `GET /api/commissioner/leagues/[id]/weekly-checklist` (scores final, claims ran, empty starters, trades awaiting review, dues, deadline/playoffs this or next week) + a deadline countdown from the league row | checklist not applicable (no season / not in season) → reason line; countdown needs both week and deadline |
| managers to check on | `getLeagueManagerHealth` rows, inactive / at-risk, minus empty seats and the viewer | no roster rows read → "could not be read" |

The card action is the existing one, **Message in league chat** (opens the League chat tab). There is no
per-manager nudge endpoint and the panel does not pretend to send one.

`health-summary` is the one route this batch adds: read-only, commissioner / co-commissioner, native
leagues only, composed entirely of reads the hub already makes.

## Visual review

`/e2e/redraft-league/deck/<tab>?sport=NBA&state=season|empty&view=<tab>` (404 in production) renders the
real tab inside the real workspace with fixture fetches. `scripts/redraft-deck-capture.mjs --base-url
<local dev> --out <dir> --phase before|after [--expect-deck]` shoots tab × sport × light/dark × 1440/390.

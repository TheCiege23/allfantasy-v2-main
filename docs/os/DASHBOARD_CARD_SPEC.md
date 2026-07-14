# Universal League Card Spec (Part 3)

Date: 2026-07-12. `components/league-hub/UniversalLeagueCard.tsx` — one
component, driven entirely by a `LeagueHubEntry`, zero provider branches.

## Audit finding: there was no per-provider duplication to replace

The phase brief asked to "replace provider-specific dashboard cards with
canonical cards." A fresh read of the live Dashboard
(`app/dashboard/components/LeagueHubCard.tsx`,
`.../warroom/MyLeagueCard.tsx`, `components/league/LeagueSidebarCard.tsx`)
found they are **already provider-agnostic** — all three consume the same
shared `UserLeague` type (`app/dashboard/types.ts`) and branch only on a
`platform` *string* for cosmetic labels (pill color, logo), not on separate
per-provider components. This is disclosed honestly rather than silently
skipping the requirement: there was nothing structurally duplicated to
replace, so this phase built the new canonical reference implementation
and documents the deferred swap-in (see the completion report) instead of
forcing a fit that doesn't exist.

## What the card renders

| Section | Source field(s) | Notes |
|---|---|---|
| League name, provider, sport, season | `leagueName`, `provider`, `sport`, `season` | Provider rendered via a static label map, not a fetched value. |
| Commissioner pill | `commissionerStatus.isCommissioner` | Shown only when real — never inferred from provider alone. |
| Team name, record, standing | `userTeam.{name,record,standingsPosition}` | Any of the three can be `null`/absent (e.g. a legacy Sleeper row with no canonical `LeagueTeam`) — the card omits the element rather than rendering a placeholder. |
| Playoff probability | `playoffProbability` | Only rendered when a real cached forecast snapshot exists; never computed client-side. |
| Capability badges | `capabilities[]` | Direct 1:1 render of `PROVIDER_CAPABILITY_MATRIX.md`'s labels — no re-derivation in the component. |
| Sync freshness dot + label | `syncFreshness.state` | Color-coded (`fresh`=green, `stale`=amber, `failed`=red, `syncing`=pulsing blue, else neutral). |
| Pending recommendations chip | `recommendations.totalCount` | Always `0` today (Part 4 contract is empty until a future OS module populates it) — the chip is real code, simply never renders yet since the count is always zero. |

## Interaction

`onSelect(entry)` is the card's only side effect — it calls
`useActiveLeagueContext().selectLeague`, establishing the shared context
(see `LEAGUE_CONTEXT_CONTRACT.md`). The card has no knowledge of what
happens after selection; `isActive` (a boolean prop) is the only feedback
it receives back.

## Styling

Matches the existing dark, opacity-token Tailwind convention already used
by `LeagueHubCard.tsx` (`bg-white/[0.04]`, `border-white/10`, etc.) rather
than introducing a new visual language — intentional, since this is
foundation work, not the "Premium visual redesign" named as a later step in
this program's own roadmap. Responsive via Tailwind grid breakpoints
(`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` in `LeagueSelector.tsx`) —
see the completion report for the real, disclosed limits of this phase's
mobile verification.

## Deferred: swapping into the live Dashboard

Recommended as its own, narrowly-scoped follow-up phase — not bundled here,
for the same reason this program declined a shallow Rankings-data-source
swap earlier: the live Dashboard is a heavily-used, already-correct surface,
and a forced same-phase swap trades a real regression risk for no safety
benefit. The follow-up phase should: (1) verify `UniversalLeagueCard`
against every real league shape the existing cards already handle
(guillotine, best-ball, keeper, dynasty concept badges — not yet ported
here), (2) swap `LeagueHubCard`/`MyLeagueCard` call sites one at a time
behind a flag, (3) keep the existing i18n-integrated
`MyLeagueCard.tsx` animation/gauge system or deliberately decide to drop it
— that's a real design decision this phase correctly did not make
unilaterally.

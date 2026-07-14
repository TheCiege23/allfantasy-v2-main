# User OS Execution Capability Matrix

Date: 2026-07-12/13. Every `LeagueRecommendation` carries a real,
truthful `executionCapability` — never implying AllFantasy performed an
action on an external provider it cannot actually reach.

## The four values, and what's real this phase

| Value | Real meaning | Used by |
|---|---|---|
| `native_execute` | AllFantasy can directly perform the action. | **Not used by any generator this phase** — see the real defect below. |
| `open_provider` | The user must act on the external provider's own site/app. | `lineupRecommendations.ts`'s `injured_starter`/`empty_slot` types for non-native providers — no `action.href` is set (there's nowhere in-product to send them). |
| `copy_action` | AllFantasy can prefill/copy the action for the user to paste elsewhere. | **Not used by any generator this phase** — no real copy-to-clipboard action path was built. |
| `recommendation_only` | Informational only. | Every generator's every recommendation this phase — including native-league lineup/roster recommendations whose `action.href` points to a real in-product page (`/league/[leagueId]?tab=team`) for the user to act on themselves. |

## Real defect found and fixed this phase: `native_execute` was initially mislabeled

While writing this doc, direct code read of `lineupRecommendations.ts` and
`rosterRecommendations.ts` found both generators originally labeled native-
league recommendations `native_execute` even though the `action` field only
links to a real page for the user to act on manually — no mutation
endpoint is called, no lineup is changed, nothing is submitted on the
user's behalf. This would have overstated AllFantasy's real capability
(the same category of problem Part 14 explicitly warns against for
external providers, just misapplied to the native case). **Fixed**: both
generators now use `recommendation_only` for native leagues too — the
`action.href` deep link is unchanged and still real, only the capability
label was corrected. A future phase that builds a real one-click execution
path (an API call that actually applies a lineup change) can then honestly
promote that specific recommendation type to `native_execute`.

## Never implies an external action was taken

Confirmed by direct code read: no generator this phase calls, or claims to
call, any provider API to submit a lineup, waiver claim, or trade on an
external platform. Every non-native recommendation is either
`open_provider` (send the user to the provider's own site) or
`recommendation_only` (informational). This matches Part 14's explicit
instruction precisely.

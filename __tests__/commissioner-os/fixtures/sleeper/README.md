# Recorded Sleeper fixtures

T-202: "recorded fixtures in CI — no live third-party calls in the gate."

These are hand-written to the shapes already committed in this repo, NOT
captured by probing the API:

  lib/engine/context-builder.ts            SleeperLeagueRaw / RosterRaw / UserRaw
  lib/ai/league-settings-ai/sleeper.ts     metadata.team_name
  lib/ai-tools-start-sit/opponentMatchup.ts:65   the name fallback order

The root CLAUDE.md's rule for the two contracted providers — "do not call the
API to determine a response shape" — is applied here by analogy. Sleeper has no
`contracts/` directory; if one is ever added, these move into it.

⚠ THEY DELIBERATELY INCLUDE THE AWKWARD CASES, not a tidy happy path:
  - a roster with `owner_id: null` (unclaimed team — normal, not an error)
  - a user with no `metadata.team_name`, falling back to display_name
  - a user with neither team_name nor display_name, falling back to username
A fixture set that only contains well-formed rows tests the mapper against a
league that does not exist in the wild.

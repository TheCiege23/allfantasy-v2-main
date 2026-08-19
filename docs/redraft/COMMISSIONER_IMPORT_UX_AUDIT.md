# Commissioner Import UX — Audit and Changes

## What changed this phase

`components/unified-import-ui/LeagueImportFlow.tsx`'s Sleeper tab was
rebuilt from a single "Build My Legacy Profile" username form into:

1. Username input + "Find my leagues" button (`discoverSleeperLeagues`),
   using the already-built `/api/leagues/import/discover` route.
2. A clickable list of the account's real Sleeper leagues (name, sport,
   season, team count), each showing a loading spinner while its preview is
   fetched and an inline "Preview loaded — see below" confirmation once done.
3. The same generic preview card, canonical-summary card, and commit/conflict
   UI already shared by ESPN/Yahoo/Fantrax/MFL (`CanonicalImportSummaryCard`,
   the "Reimport over existing" 409-conflict flow) — no new UI primitives
   were introduced for Sleeper specifically.
4. Hero and section copy updated to describe league import truthfully
   ("Import your league" / "Bring your Sleeper, ESPN, Yahoo, Fantrax, or MFL
   league into AllFantasy as a real, playable league") instead of the old
   career-profile framing.

Retry-on-failed-preview UI (`failedPreview` state, a "Retry preview" button)
was added concurrently by a separate process during this phase — reviewed,
confirmed compatible, left in place per the instruction not to revert
unrelated intentional changes.

## Provider selection shell (Part 10 — shared, not redesigned)

All five providers already shared one tab strip, one card shell, one
`warroom-*` motion language, and one collapsible "Provider connection
details" panel before this phase — confirmed via source read, not rebuilt.
The truthful per-provider auth labeling already existed in
`ImportSourceInputPanel.tsx`'s `PROVIDER_INPUT_CONFIG` (Sleeper: league ID;
ESPN: cookie-based; Yahoo: OAuth via League Sync; MFL: API key; Fantrax:
"legacy league snapshots" — already correctly not described as a live API).
No changes were made to this shared shell or to the other four providers'
input UI this phase, per the explicit instruction to certify Sleeper before
touching the others.

## Progress model (Part 9)

The discovery step shows real, live progress: "Loading preview..." while
`discoverSleeperLeagues` is in flight, then a per-card spinner while that
specific league's preview loads, then an inline success indicator. This is
truthful, incremental progress (no stage is marked complete before its real
work finishes) but is not the full nine-stage progress list described in the
brief ("Connecting to Sleeper / Reading league settings / Importing managers
and rosters / ..."). Building that granular a progress model would require
the commit pipeline to report intermediate stage completion back to the
client, which it does not do today (`persistImportedLeagueFromNormalization`
runs as a single transaction with no streaming/interim-status channel) —
**deliberately not built this phase**, disclosed as a real gap rather than
faked with a client-side timer that doesn't reflect real server progress.

## Failure and recovery states

- Retry-on-failed-preview: present (see above).
- Existing-import conflict (409): present, unchanged, shared by all providers.
- Authorization failure (401/403): present — the commit route's real error
  message is surfaced via `formError`; no raw stack trace or provider payload
  is ever shown (confirmed via reading `getImportApiErrorMessage`'s mapping
  in `LeagueCreationImportSubmissionService.ts`, which converts known error
  codes to human copy and otherwise falls back to the server's own `error`
  string — never a raw exception).
- Provider unavailable / data mismatch / partial historical availability:
  surfaced generically via `formError`; no dedicated UI distinguishes these
  from any other preview/commit failure. Deferred — a real but smaller gap
  than the discovery/progress work above.

## Mobile

Not independently re-verified via a live browser this phase (no dev server
was started; this phase's verification was source-level + physical database,
per the brief's own instruction to prioritize physical database proof over
UI-only checks for this backend-heavy phase). The changed markup reuses the
same responsive Tailwind classes (`grid-cols-2 sm:grid-cols-5`, `flex-1`,
`w-full`) already used by the unaffected tab strip and card shell, so no new
responsive-layout risk was introduced, but this is a source-level judgment,
not a screenshot-verified one — disclosed honestly rather than claimed as
proven.

## What was deliberately not done (Part 10 guardrail)

- No redesign of ESPN/Yahoo/Fantrax/MFL's input UI.
- No change to Fantrax's CSV-based model or its labeling.
- No full nine-stage progress model (see above).
- No account-discovery UI for ESPN/Yahoo/MFL/Fantrax (their backend discovery
  isn't implemented — `supportsImportProviderDiscovery` gates this to
  Sleeper only, confirmed via source read).

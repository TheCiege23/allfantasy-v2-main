# Decision OS Phase 2 — Refresh Resolver Support Matrix

A managed-intelligence result is refreshed only when a registered `CurrentEvidenceResolver` can rebuild the
tool's request from **authoritative persisted DB state** (never the old minimized request snapshot). If no
resolver supports a tool, that tool is **explicitly unsupported**: the enqueue side never arms a durable refresh
(no 10-minute retry churn), and any manually-created job is refused honestly.

The production default (`createManagedIntelligenceDeps`) registers `LeagueEvidenceResolver`.

## Supported now

| Tool | Resolver | Tables read (all persisted, all current) | Required freshness | Live-sensitive decisions |
| --- | --- | --- | --- | --- |
| `manager_intelligence` | `LeagueEvidenceResolver` → `buildLeagueIntelligenceEvidence` | `League` (settings snapshot, scoring/`scoringPresetId`, sport, season, platform/`platformLeagueId`, status, `syncStatus`, `settingsSnapshotVersion`, `importedAt`); `IntelligenceLeagueSnapshot` (trade/waiver/lineup/scoring/governance/draft counts, `openTradeProposals`, `lastActivityAt` — the source-version signal); `Roster` (count). **Single league only** (connected-group scope is unsupported — see below). | Behavioral/managerial: the persisted `IntelligenceLeagueSnapshot` **is** the current source of truth. A real activity change (new trade/waiver/lineup/…) bumps counts + `lastActivityAt` → new source version + evidence fingerprint → **new canonical identity → recompute**. Unchanged evidence → **reuse without a provider call**. | Refused. For any live-sensitive decision type (injury/weather/live/lineup/start_sit) the resolver reports `isLive:false` and the refresh worker refuses (`live_evidence_stale_or_unavailable`) — a live answer is never built from non-live persisted evidence. Such results are also classified as MISS (never stale), so they are never enqueued in the first place. |

Reason it is safe now: manager intelligence is a behavioral/managerial analysis whose evidence is fully and
durably persisted. `buildLeagueIntelligenceEvidence` is the **shared canonical assembly** — the Phase 3 route
will build the *original* request with the same function, so an unchanged league recanonicalizes to the same
identity (reuse) and any real change forks a new one (recompute). Imported/shadow leagues are analyzed
**read-only** (the resolver only READs; `ctx.isImportedLeague` is surfaced).

### Connected-group scope is explicitly UNSUPPORTED (Phase 2)

Rebuilding **complete** connected-group evidence — resolve every member league, verify the user's access to each,
load each league's settings/scoring/season/roster/snapshot/source-version, preserve separate NFL and NCAAF pools,
canonicalize deterministically, and fold every member's version into the fingerprint — is a Phase 3 task. Phase 2
does **not** fake it by tagging one league's evidence with a group id. So a request carrying a `connectedGroupId`:

- `LeagueEvidenceResolver.supports(tool, decisionType, connectedGroupId)` → **false** → `refreshSupported` false →
  **no refresh job enqueued** (no 10-minute churn);
- `buildLeagueIntelligenceEvidence({… connectedGroupId})` → `{ ok:false, reason:'connected_group_refresh_unsupported' }`;
- a drained connected job → `DbEvidenceRehydrator` refuses `connected_group_refresh_unsupported` → the stale result
  is **served without a freshness bump**, with honest refresh-unavailable metadata.

Identity inclusion of `connectedGroupId` (collision-avoidance) is **not** the same as evidence support and is not
claimed as such. Proven in `three-brain-phase2-hardening-integration.test.ts` → "a CONNECTED-group request is
refresh-UNSUPPORTED …".

## Explicitly unsupported (until Phase 3)

| Tool | Status | Reason |
| --- | --- | --- |
| `commissioner_command_center` | unsupported | Its live packet assembly (which governance/attention/fairness signals feed the decision, and their exact provenance) is defined by the Phase 3 commissioner route; until that shared builder exists, a refresh cannot faithfully recanonicalize. No enqueue. |
| `user_os` | unsupported | Per-manager cross-league profile assembly is not yet a single persisted builder; Phase 3 defines it. No enqueue. |
| `mission_control` | unsupported | League-home mission-control packet spans standings/matchup surfaces whose canonical assembly is Phase 3. No enqueue. |

Unsupported is enforced two ways: `LeagueEvidenceResolver.supports()` returns false → `refreshSupported()` is
false → the stale-serve path does **not** enqueue; and if a job somehow exists, `DbEvidenceRehydrator` returns
`refresh_unsupported_tool` so the drain refuses without bumping freshness.

## Failure semantics (all honest, all fail-safe)

| Condition | Result |
| --- | --- |
| League row missing, or no `IntelligenceLeagueSnapshot` persisted | `evidence_unavailable` — refuse; stale is not falsely refreshed. |
| Run has no `leagueId` | `evidence_requires_league` — refuse. |
| Live-sensitive decision, non-live evidence | `live_evidence_stale_or_unavailable` — refuse. |
| Tool has no registered resolver | `refresh_unsupported_tool` — refuse; never enqueued. |
| Evidence loaded, materially unchanged | Reuse existing result, extend TTL, **zero provider spend**. |
| Evidence loaded, materially changed | New canonical identity → provider recompute → replacement result persisted. |

Proven end-to-end (against the isolated DB) in
`__tests__/decision-os/three-brain-phase2-hardening-integration.test.ts` →
"Blocker 1 — registered production resolver: end-to-end durable refresh cycle".

# Multiplayer Draft Certification Script

## Preconditions and clients

Stop before navigation unless all are proven:

- Non-production application URL, database identity, build SHA, sport, league ID and draft ID.
- Disposable or explicitly approved NFL/NCAAF test league with enough teams and a supported snake/linear draft.
- Three independently authenticated trusted browser clients: Commissioner, Manager A and Manager B. No shared session cookie.
- Each identity is a member of the same league with its expected team; a non-member identity is available for one denial check.
- Realtime/browser console, network capture, API correlation and read-only persistence inspection are available.
- Player pool has been checked for the selected sport; production and fixture data are excluded.

Record browser/version/device, client clock, connection identifier if exposed, and screen recording/screenshot index. Run once for NFL and once for NCAAF. NCAAF evidence must prove zero NFL-player leakage.

## Execution script

| # | Actor and action | Expected result | Evidence |
| --- | --- | --- | --- |
| 1 | All: open the same pre-draft room and record state | Same draft ID, order, round/pick, timer, sport and participants | Three screenshots, state/API hashes, DB draft row |
| 2 | Manager A/B: attempt commissioner start | Denied without mutation or information leakage | Network response, unchanged DB/realtime state |
| 3 | Commissioner: start draft once, then retry the start action | Exactly one transition to live; all clients synchronize | Three recordings, start requests, audit/event/state row |
| 4 | Current manager: select an eligible player and submit | One pick persists in correct slot; player disappears everywhere; timer advances once | Three screens, request/correlation ID, pick and availability rows |
| 5 | Same client: replay the identical pick request/idempotency key | Existing result or deterministic conflict; no duplicate pick/event/notice | Both responses, count queries, event/audit evidence |
| 6 | Non-current manager: attempt a pick | Denied; draft state and timer remain authoritative | Response and unchanged state |
| 7 | Manager A and B: submit competing requests for the same currently available player at the permitted boundary | At most one succeeds; loser receives deterministic conflict and refreshes | Timestamped requests, serial order, one pick/owner row |
| 8 | All: refresh after multiple picks | Each returns to the same authoritative board, queue and clock | Screens plus GET/state hashes |
| 9 | Commissioner: pause | Timer/picks stop for all; pause reason/state persists | Three clients, state/audit row |
| 10 | Manager: attempt pick while paused | Denied without mutation | Response and DB counts |
| 11 | Commissioner: resume; retry resume | One resumed transition; timer/state synchronized | Three clients, requests, audit/state |
| 12 | Commissioner: perform a supported pick correction with confirmation | Original/corrected state follows domain policy, availability/rosters reconcile, audit is immutable | Before/after screens, requests, pick/roster/audit rows |
| 13 | Manager A: disconnect/network offline; other manager makes a legal pick; A reconnects | Reconnected client catches up without duplicate/missing picks or stale availability | Realtime/network trace, before/after state hashes |
| 14 | Commissioner: reload/close and reopen | Commissioner authority and draft state restore from server, not client memory | Session/state evidence |
| 15 | Manager A: send chat message; Manager B refreshes | One ordered persistent message visible to league members | Two clients, chat API and row |
| 16 | Manager B: mention Manager A using autocomplete; exercise duplicate display-name case if available | Mention maps to canonical member ID; styling persists; notification is claimed only if observed | UI, sanitized payload/row, delivery evidence or explicit none |
| 17 | Non-member: request draft/chat endpoints | Denied; no roster, queue or private chat data leaks | Sanitized responses and unchanged state |
| 18 | Current actor: inspect recommendation/research, then another client makes a pick | Recommendation/player availability updates to live authoritative state; provider unavailable state is truthful | Before/after UI, network, provider/cache metadata |
| 19 | Continue or use authorized acceleration until final pick | Every slot has one valid pick; no duplicate player; completion occurs once | Pick counts/uniqueness query, event/audit, three clients |
| 20 | All: navigate to roster and draft recap, then refresh | Rosters exactly match picks; recap/order persist; league transitions to post-draft | Screens, roster/pick invariant queries, lifecycle row |

## Optional draft-pick trade scenario

Run only if the configured league and current invited-MVP matrix genuinely support live traded picks. Propose/accept the pick trade before the affected slot, verify ownership/order on all clients, make the pick under the new owner, and prove persisted ownership and audit history. Otherwise mark `NOT SUPPORTED`; do not simulate it with roster-player trades.

## Required invariants

- Pick count equals occupied draft slots; each slot and player are unique within the draft.
- Every accepted pick belongs to the authorized on-clock team at commit time.
- Player availability, board, roster materialization, recap and persisted picks agree.
- Retried commands do not duplicate mutations, events, audits, outbox entries, or notices.
- Pause/resume/start/completion transition exactly once.
- All three clients converge after refresh and reconnect.
- NFL and NCAAF pools remain isolated.
- Chat membership and commissioner authorization are enforced server-side.
- No raw backend/provider error, secret, provider-specific shape, or unsupported claim reaches the UI.

## Failure injection and evidence rules

For a safe non-production environment, interrupt one pick request before receiving its response, reconnect, and retry with the same idempotency key. Record the first request's server disposition before asserting the retry result. Never infer failure from a client timeout.

Each row requires: evidence ID, timestamp, all involved roles, route/request ID, expected/observed result, screenshot/video, console/network status, persisted before/after evidence, severity, and pass/fail. Skips, retries used to hide instability, and timeouts are not passes.

## Stop and rollback policy

Stop immediately on a P0 (duplicate/lost pick, wrong ownership/sport, cross-league access, corrupt roster) or repeated P1. Preserve logs and the disposable draft. Use only the established non-destructive rollback/cleanup path; never rewrite history or mutate production.

## Closeout truth table

```text
TRUSTED THREE-CLIENT ENVIRONMENT: YES / NO
NON-PRODUCTION DB IDENTITY VERIFIED: YES / NO
NFL MULTIPLAYER DRAFT: PASS / FAIL / BLOCKED
NCAAF MULTIPLAYER DRAFT: PASS / FAIL / BLOCKED
PICK PERSISTENCE AND UNIQUENESS: PASS / FAIL / BLOCKED
RETRY IDEMPOTENCY: PASS / FAIL / BLOCKED
CONCURRENT PICK SAFETY: PASS / FAIL / BLOCKED
PAUSE/RESUME/CORRECTION: PASS / FAIL / BLOCKED
REFRESH/RECONNECT CONVERGENCE: PASS / FAIL / BLOCKED
CHAT AND MENTIONS: PASS / FAIL / BLOCKED
POST-DRAFT ROSTER MATERIALIZATION: PASS / FAIL / BLOCKED
OPEN P0/P1 DEFECTS: <count>
MULTIPLAYER GATE: PASS / FAIL / BLOCKED
```

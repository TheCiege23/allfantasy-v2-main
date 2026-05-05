/**
 * NFL redraft queue + autopick — source-level contract lock (Commit Q).
 *
 * Pins the queue-write and autopick-execution invariants so a future
 * refactor can't silently regress:
 *
 *   1. Queue PUT route runs the standard hygiene chain on every save:
 *        normalizeQueueEntries → dedupeQueueEntries → roster-eligibility
 *        validation → removeDraftedPlayersFromQueue → upsert into
 *        DraftQueue keyed by (sessionId, userId).
 *      The 400 response surfaces the offending positions so the client
 *      can render a precise inline error.
 *   2. Queue GET reads via `loadDraftQueueForUser` and returns the
 *      `removedUnavailable` count so the client can surface a banner
 *      when previously-queued players were drafted by someone else.
 *   3. autopick-expired route enforces the canonical lockout chain:
 *      not-on-clock → 403 + DRAFT_PICK_NOT_ON_CLOCK; queue-first
 *      candidate filtered by `isDraftPickRowEmpty`-aware drafted set
 *      and roster-eligible positions; skip / AI / BPA fallback when no
 *      queue candidate; submitPick is the single writer; expectedOverall
 *      flows through to the Commit-M stale guard.
 *   4. tryQueueAutoPick (slow-draft cron) computes
 *      `expectedOverall = picks.length + 1`, passes it to every
 *      candidate's submitPick attempt, and bails the candidate loop on
 *      DRAFT_PICK_STALE_OVERALL / DRAFT_PICK_RACE_RETRY rather than
 *      thrashing through doomed retries.
 *   5. submitBestAvailableAutopickForExpiredTimer accepts and forwards
 *      `expectedOverall` (Commit-M race guard); tries AI opponent
 *      first, then `resolveBestAvailableAutopickCandidate`.
 *   6. processExpiredDraftPicks (expired-pick cron) computes its own
 *      `expectedOverall` and forwards it through both the skip and BPA
 *      paths.
 *   7. All autopick paths use the canonical
 *      `lib/live-draft-engine/PickSubmissionService.submitPick`. None
 *      import the legacy `lib/draft/execute-pick.ts`.
 *   8. DraftQueue prisma model is keyed by composite (sessionId, userId)
 *      so refresh / reconnect picks up the saved queue.
 *   9. Commit J / L / M / N / O / P locks still wired.
 *
 * Static-source assertions only — keeps the lock cheap and avoids the
 * full live-draft-engine harness for what is fundamentally a code-shape
 * contract. Behavioural unit tests for the helpers
 * (`dedupeQueueEntries`, `isRookieEligibleForFilter`, the pick
 * authority codes, etc.) live in their own existing test files.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('Queue PUT route — hygiene chain', () => {
  const src = read('app/api/leagues/[leagueId]/draft/queue/route.ts')

  it('imports the canonical queue-engine helpers', () => {
    expect(src).toMatch(
      /import \{[\s\S]*?dedupeQueueEntries[\s\S]*?normalizeDraftedNameSet[\s\S]*?normalizeQueueEntries[\s\S]*?removeDraftedPlayersFromQueue[\s\S]*?\} from '@\/lib\/draft-queue-engine'/,
    )
  })

  it('runs normalize → dedupe before roster-eligibility validation', () => {
    expect(src).toMatch(
      /dedupeQueueEntries\([\s\S]*?normalizeQueueEntries\(queue, queueSizeLimit\)/,
    )
  })

  it('rejects with 400 + offending positions when queue contains starter-ineligible positions', () => {
    expect(src).toMatch(/Queue contains players with positions not starter-eligible/)
    expect(src).toMatch(/status: 400/)
  })

  it('strips drafted players via removeDraftedPlayersFromQueue before persisting', () => {
    expect(src).toMatch(
      /const cleaned = removeDraftedPlayersFromQueue\(normalized, draftedNames\)/,
    )
  })

  it('persists to prisma.draftQueue keyed by composite (sessionId, userId)', () => {
    expect(src).toMatch(
      /prisma\.draftQueue\.upsert\(\{[\s\S]+?where: \{ sessionId_userId: \{ sessionId: draftSession\.id, userId \} \}/,
    )
  })

  it('GET returns leagueId, queue, and removedUnavailable so the client can banner', () => {
    expect(src).toMatch(/loadDraftQueueForUser\(leagueId, userId\)/)
    expect(src).toMatch(/removedUnavailable,/)
  })
})

describe('autopick-expired route — lockout + fallback chain', () => {
  const src = read('app/api/leagues/[leagueId]/draft/autopick-expired/route.ts')

  it('returns 403 + DRAFT_PICK_NOT_ON_CLOCK when caller is not on the clock', () => {
    expect(src).toMatch(
      /code: DRAFT_PICK_NOT_ON_CLOCK[\s\S]+?httpStatusForPickAuthorityCode\(DRAFT_PICK_NOT_ON_CLOCK\)/,
    )
  })

  it('filters queue candidates against the drafted-name set (skips already-drafted)', () => {
    expect(src).toMatch(/draftedNames\.has\(/)
    expect(src).toMatch(
      /availableInQueue = order\.filter\([\s\S]+?!draftedNames\.has\(/,
    )
  })

  it('filters queue by starter-eligible positions before picking', () => {
    expect(src).toMatch(
      /eligibleInQueue = filterEntriesByDraftEligiblePositions\(availableInQueue, draftEligiblePositions\)/,
    )
  })

  it('falls back through skip → AI → BPA when no queue candidate is eligible', () => {
    // skip behavior short-circuit returns early
    expect(src).toMatch(/autopickBehavior === 'skip'/)
    // AI opponent attempt before BPA
    expect(src).toMatch(/tryAiOpponentAutopickForExpiredTimer/)
    // BPA fallback
    expect(src).toMatch(/resolveBestAvailableAutopickCandidate/)
  })

  it('forwards expectedOverall to submitPick (Commit-M stale guard)', () => {
    expect(src).toMatch(/const expectedOverall = draftSession\.picks\.length \+ 1/)
    expect(src).toMatch(/expectedOverall,/)
  })

  it('uses the canonical submitPick — never the legacy executeDraftPick', () => {
    expect(src).toMatch(
      /import \{[^}]*submitPick[^}]*\} from '@\/lib\/live-draft-engine\/PickSubmissionService'/,
    )
    expect(src).not.toMatch(/from '@\/lib\/draft\/execute-pick'/)
  })

  it('routes submitPick.code through the central status mapper', () => {
    expect(src).toMatch(/httpStatusForPickAuthorityCode\(result\.code as PickAuthorityCode\)/)
  })
})

describe('tryQueueAutoPick — race-aware candidate loop', () => {
  const src = read('lib/live-draft-engine/slow-draft/SlowDraftRuntimeService.ts')

  it('computes expectedOverall = picks.length + 1 once before the candidate loop', () => {
    expect(src).toMatch(/const expectedOverall = draftSession\.picks\.length \+ 1/)
  })

  it('passes expectedOverall to every submitPick attempt', () => {
    expect(src).toMatch(
      /for \(const entry of eligibleQueueCandidates[\s\S]+?submitPick\(\{[\s\S]+?expectedOverall,/,
    )
  })

  it('bails the candidate loop on DRAFT_PICK_STALE_OVERALL / DRAFT_PICK_RACE_RETRY', () => {
    expect(src).toMatch(
      /attempt\.code === 'DRAFT_PICK_STALE_OVERALL' \|\| attempt\.code === 'DRAFT_PICK_RACE_RETRY'/,
    )
  })

  it('skips drafted queue entries before attempting submitPick', () => {
    expect(src).toMatch(/!draftedNames\.has\(normalizeName\(playerName\)\)/)
  })

  it('filters by starter-eligible positions before attempting submitPick', () => {
    expect(src).toMatch(
      /eligibleQueueCandidates = filterEntriesByDraftEligiblePositions\(queueCandidates, draftEligiblePositions\)/,
    )
  })

  it('uses the canonical submitPick (no legacy executeDraftPick)', () => {
    expect(src).toMatch(
      /import \{[^}]*submitPick[^}]*\} from '@\/lib\/live-draft-engine\/PickSubmissionService'/,
    )
    expect(src).not.toMatch(/from '@\/lib\/draft\/execute-pick'/)
  })
})

describe('submitBestAvailableAutopickForExpiredTimer — Commit Q signature', () => {
  const src = read('lib/live-draft-engine/autopickBestAvailableSubmit.ts')

  it('accepts an optional expectedOverall parameter', () => {
    expect(src).toMatch(
      /export async function submitBestAvailableAutopickForExpiredTimer\([\s\S]+?expectedOverall\?: number\s*\)/,
    )
  })

  it('forwards expectedOverall into the submitPick call', () => {
    expect(src).toMatch(/submitPick\(\{[\s\S]+?expectedOverall,/)
  })

  it('tries the AI opponent autopick first, then BPA', () => {
    expect(src).toMatch(
      /tryAiOpponentAutopickForExpiredTimer[\s\S]+?if \(aiTry\.ok\) return aiTry[\s\S]+?resolveBestAvailableAutopickCandidate/,
    )
  })

  it('uses the canonical submitPick (no legacy executeDraftPick)', () => {
    expect(src).toMatch(
      /import \{ submitPick \} from '@\/lib\/live-draft-engine\/PickSubmissionService'/,
    )
    expect(src).not.toMatch(/from '@\/lib\/draft\/execute-pick'/)
  })
})

describe('processExpiredDraftPicks — race-aware cron', () => {
  const src = read('lib/live-draft-engine/expired-picks/processExpiredDraftPicks.ts')

  it('computes expectedOverall = session.picks.length + 1 once per league tick', () => {
    expect(src).toMatch(/const expectedOverall = session\.picks\.length \+ 1/)
  })

  it('forwards expectedOverall through the skip path', () => {
    expect(src).toMatch(
      /submitPick\(\{[\s\S]+?position: 'SKIP'[\s\S]+?expectedOverall,/,
    )
  })

  it('forwards expectedOverall to submitBestAvailableAutopickForExpiredTimer', () => {
    expect(src).toMatch(
      /submitBestAvailableAutopickForExpiredTimer\(leagueId, onClockRosterId, expectedOverall\)/,
    )
  })

  it('uses the queue-first path (tryQueueAutoPick) before BPA', () => {
    expect(src).toMatch(/const queuePick = await tryQueueAutoPick\(/)
  })

  it('uses the canonical submitPick (no legacy executeDraftPick)', () => {
    expect(src).toMatch(
      /import \{ submitPick \} from '@\/lib\/live-draft-engine\/PickSubmissionService'/,
    )
    expect(src).not.toMatch(/from '@\/lib\/draft\/execute-pick'/)
  })
})

describe('DraftQueue prisma model is keyed for refresh-survivable storage', () => {
  const src = read('prisma/schema.prisma')

  it('declares a DraftQueue model', () => {
    expect(src).toMatch(/model DraftQueue \{/)
  })

  it('has a composite unique key (sessionId, userId)', () => {
    // Prisma generated the upsert helper `sessionId_userId`, which only exists
    // when this composite uniqueness is declared on the model.
    expect(src).toMatch(/@@unique\(\[sessionId, userId\]\)/)
  })
})

describe('Commit J / L / M / N / O / P locks still hold after Commit Q', () => {
  it('Commit J — DraftRoomPageClient still has the 409 / DRAFT_SESSION_MISMATCH in-place handler', () => {
    const drpc = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(drpc).toMatch(
      /res\.status === 409 && \(data as \{ code\?: unknown \}\)\?\.code === 'DRAFT_SESSION_MISMATCH'/,
    )
    expect(drpc).toMatch(/setSessionMismatchRecovering\(true\)/)
  })

  it('Commit L — executeDraftPick still calls assertLegacyDraftRuntimeWriteAllowed before any prisma write', () => {
    const exec = read('lib/draft/execute-pick.ts')
    const guardIdx = exec.indexOf('assertLegacyDraftRuntimeWriteAllowed({')
    expect(guardIdx).toBeGreaterThan(0)
    const writeIdx = exec.indexOf('prisma.draftRoomPickRecord')
    expect(writeIdx).toBeGreaterThan(guardIdx)
  })

  it('Commit M — submitPick still has the expectedOverall stale guard and race-retry tagging', () => {
    const sps = read('lib/live-draft-engine/PickSubmissionService.ts')
    expect(sps).toMatch(
      /input\.expectedOverall !== overall[\s\S]+?code: DRAFT_PICK_STALE_OVERALL/,
    )
    expect(sps).toMatch(/code: DRAFT_PICK_RACE_RETRY/)
  })

  it('Commit N — PlayerPanel still imports both rookies/vets predicates', () => {
    const pp = read('components/app/draft-room/PlayerPanel.tsx')
    expect(pp).toMatch(
      /import \{[^}]*isRookieEligibleForFilter[^}]*isVetEligibleForFilter[^}]*\} from '@\/lib\/draft-room\/rookieFilterPredicate'/,
    )
  })

  it('Commit O — pool resolver test still mocks loadPlayerSeasonStatsFallback', () => {
    const t = read('__tests__/getResolvedDraftPoolForLeague.unit.test.ts')
    expect(t).toMatch(/loadPlayerSeasonStatsFallback/)
  })

  it('Commit P — DraftPlayerCard still exposes the stable data testids', () => {
    const card = read('components/app/draft-room/DraftPlayerCard.tsx')
    expect(card).toMatch(/'draft-player-name'/)
    expect(card).toMatch(/'draft-player-injury-status'/)
    expect(card).toMatch(/'draft-player-stats-summary'/)
    expect(card).toMatch(/'draft-player-adp'/)
    expect(card).toMatch(/'draft-player-bye'/)
  })
})

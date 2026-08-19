import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeRawMock = vi.fn()
const logStructuredMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRawMock(...args),
  },
}))

vi.mock('@/lib/logging/structured', () => ({
  logStructured: (...args: unknown[]) => logStructuredMock(...args),
}))

import {
  MAX_TRACKED_MISMATCHES,
  PlayerMismatchCollector,
  mismatchFingerprint,
  summarizePlayerMismatchForAi,
} from '@/lib/player-identity/playerMismatchLogger'

beforeEach(() => {
  executeRawMock.mockReset()
  executeRawMock.mockResolvedValue(1)
  logStructuredMock.mockReset()
})

describe('mismatchFingerprint', () => {
  /**
   * Pinned on purpose. This digest is the primary key of player_identity_mismatch_stats and is
   * recomputed in SQL by the historical backfill. If a refactor changes the inputs, their order,
   * or the separators, every counter silently restarts and the backfill stops folding onto live
   * rows — a green test suite would otherwise hide that.
   *
   * Parity with Postgres was verified directly against production:
   *   SELECT encode(sha256(convert_to(concat_ws(chr(31), 'lg_123','NFL',
   *     'ID_DRIFT_STRICT_MATCH_USED','Justin Jefferson','WR','MIN'), 'UTF8')),'hex')
   * returns exactly the digest below.
   */
  it('is stable for a fully populated fact', () => {
    expect(
      mismatchFingerprint({
        leagueId: 'lg_123',
        sport: 'NFL',
        reason: 'ID_DRIFT_STRICT_MATCH_USED',
        playerName: 'Justin Jefferson',
        position: 'WR',
        team: 'MIN',
      }),
    ).toBe('f963540284ada45848c372ee0ea35b6631dad1e665f075035eecd8a1a6f3f80a')
  })

  /** The all-nulls shape is what AMBIGUOUS_LOOSE_MATCH_SKIPPED writes; SQL parity verified too. */
  it('is stable when the nullable fields are absent', () => {
    expect(
      mismatchFingerprint({
        leagueId: null,
        sport: 'NFL',
        reason: 'AMBIGUOUS_LOOSE_MATCH_SKIPPED',
        playerName: null,
        position: null,
        team: null,
      }),
    ).toBe('2debeac319d6cc45b698041feaffa2c43b9cab12fd121d22b39b489565fc53b4')
  })

  it('separates fields so adjacent values cannot be confused for one another', () => {
    const a = mismatchFingerprint({
      leagueId: 'ab',
      sport: 'NFL',
      reason: 'LOW_CONFIDENCE_MATCH',
      playerName: null,
      position: null,
      team: null,
    })
    const b = mismatchFingerprint({
      leagueId: 'a',
      sport: 'bNFL',
      reason: 'LOW_CONFIDENCE_MATCH',
      playerName: null,
      position: null,
      team: null,
    })
    expect(a).not.toBe(b)
  })
})

describe('PlayerMismatchCollector.record', () => {
  it('collapses repeat sightings of the same fact onto one counter', () => {
    const collector = new PlayerMismatchCollector()
    for (let i = 0; i < 250; i++) {
      collector.record({
        leagueId: 'lg_1',
        sport: 'NFL',
        reason: 'NO_SPORT_PLAYER_RECORD_MATCH',
        playerName: 'Justin Jefferson',
        position: 'WR',
        team: 'MIN',
      })
    }

    expect(collector.size).toBe(1)
    expect(collector.snapshot()[0]?.occurrences).toBe(250)
  })

  it('keeps genuinely distinct facts apart', () => {
    const collector = new PlayerMismatchCollector()
    collector.record({ sport: 'NFL', reason: 'NO_SPORT_PLAYER_RECORD_MATCH', playerName: 'A' })
    collector.record({ sport: 'NFL', reason: 'NO_SPORT_PLAYER_RECORD_MATCH', playerName: 'B' })
    collector.record({ sport: 'NFL', reason: 'ID_DRIFT_STRICT_MATCH_USED', playerName: 'A' })
    collector.record({ sport: 'NCAAF', reason: 'NO_SPORT_PLAYER_RECORD_MATCH', playerName: 'A' })

    expect(collector.size).toBe(4)
  })

  it('normalizes sport case and blank values so they do not fork the key', () => {
    const collector = new PlayerMismatchCollector()
    collector.record({
      sport: 'nfl',
      reason: 'NO_SPORT_PLAYER_RECORD_MATCH',
      playerName: '  Justin Jefferson  ',
      position: 'WR',
      team: '   ',
    })
    collector.record({
      sport: 'NFL',
      reason: 'NO_SPORT_PLAYER_RECORD_MATCH',
      playerName: 'Justin Jefferson',
      position: 'WR',
      team: null,
    })

    expect(collector.size).toBe(1)
    const bucket = collector.snapshot()[0]
    expect(bucket?.occurrences).toBe(2)
    expect(bucket?.sport).toBe('NFL')
    expect(bucket?.playerName).toBe('Justin Jefferson')
    expect(bucket?.team).toBeNull()
  })

  it('clamps an over-long player name to the column width instead of failing the insert', () => {
    const collector = new PlayerMismatchCollector()
    collector.record({
      sport: 'NFL',
      reason: 'NO_SPORT_PLAYER_RECORD_MATCH',
      playerName: 'x'.repeat(500),
    })
    expect(collector.snapshot()[0]?.playerName).toHaveLength(256)
  })

  it('drops new facts past the cap but keeps counting known ones, and reports the drop', async () => {
    const collector = new PlayerMismatchCollector()
    for (let i = 0; i < MAX_TRACKED_MISMATCHES + 25; i++) {
      collector.record({
        sport: 'NFL',
        reason: 'NO_SPORT_PLAYER_RECORD_MATCH',
        playerName: `Player ${i}`,
      })
    }
    // A fact recorded before the cap was hit still increments.
    collector.record({ sport: 'NFL', reason: 'NO_SPORT_PLAYER_RECORD_MATCH', playerName: 'Player 0' })

    expect(collector.size).toBe(MAX_TRACKED_MISMATCHES)
    expect(collector.droppedCount).toBe(25)

    const result = await collector.flush()
    expect(result.dropped).toBe(25)
    expect(logStructuredMock).toHaveBeenCalledWith(
      'warn',
      'player_mismatch_logger',
      'tracking_cap_exceeded',
      expect.objectContaining({ dropped: 25, cap: MAX_TRACKED_MISMATCHES }),
    )
  })
})

describe('PlayerMismatchCollector.flush', () => {
  it('writes nothing when there is nothing to report', async () => {
    const result = await new PlayerMismatchCollector().flush()
    expect(executeRawMock).not.toHaveBeenCalled()
    expect(result).toEqual({ distinctFacts: 0, occurrences: 0, dropped: 0, ok: true })
  })

  it('persists a whole pass in a single statement rather than one per sighting', async () => {
    const collector = new PlayerMismatchCollector()
    for (let i = 0; i < 400; i++) {
      for (let repeat = 0; repeat < 5; repeat++) {
        collector.record({
          leagueId: 'lg_1',
          sport: 'NFL',
          reason: 'NO_SPORT_PLAYER_RECORD_MATCH',
          playerName: `Player ${i}`,
        })
      }
    }

    const result = await collector.flush()

    // 2,000 sightings -> 400 facts -> 1 INSERT. The old logger issued 2,000 un-awaited creates.
    expect(executeRawMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ distinctFacts: 400, occurrences: 2000, dropped: 0, ok: true })
  })

  it('chunks large passes so the statement stays under the parameter ceiling', async () => {
    const collector = new PlayerMismatchCollector()
    for (let i = 0; i < 1200; i++) {
      collector.record({ sport: 'NFL', reason: 'NO_SPORT_PLAYER_RECORD_MATCH', playerName: `P${i}` })
    }

    await collector.flush()
    // 1200 facts / 500 per chunk
    expect(executeRawMock).toHaveBeenCalledTimes(3)
  })

  /**
   * Guards a behaviour these tests cannot otherwise reach: $executeRaw is mocked, so the SQL's
   * semantics are only observable against a real database. Verified there — a sparse sighting
   * following a rich one keeps last_confidence=0.8765 rather than nulling it. A bare
   * `= EXCLUDED.x` would silently erase real diagnostics, so assert the COALESCE stays.
   */
  it('merges last_* observations without letting a sparser sighting null them out', async () => {
    const collector = new PlayerMismatchCollector()
    collector.record({ sport: 'NFL', reason: 'NO_SPORT_PLAYER_RECORD_MATCH', playerName: 'A' })
    await collector.flush()

    const sql = (executeRawMock.mock.calls[0]?.[0] as string[]).join('?')
    for (const column of [
      'last_pool_player_id',
      'last_pool_external_id',
      'last_sports_player_record_id',
      'last_attempted_match_type',
      'last_confidence',
      'last_details',
    ]) {
      expect(sql).toContain(`"${column}" = COALESCE(EXCLUDED."${column}"`)
    }
    // Counters accumulate; the clock only moves forward.
    expect(sql).toContain('"occurrences" = "player_identity_mismatch_stats"."occurrences" + EXCLUDED."occurrences"')
    expect(sql).toContain('"last_seen_at" = GREATEST(')
  })

  it('resets after flushing so a reused collector cannot double-count', async () => {
    const collector = new PlayerMismatchCollector()
    collector.record({ sport: 'NFL', reason: 'NO_SPORT_PLAYER_RECORD_MATCH', playerName: 'A' })
    await collector.flush()

    expect(collector.size).toBe(0)
    const second = await collector.flush()
    expect(second.distinctFacts).toBe(0)
    expect(executeRawMock).toHaveBeenCalledTimes(1)
  })

  /**
   * The regression this file exists for: the previous logger only logged failures when
   * NODE_ENV !== 'production', so the exact environment that mattered was the silent one.
   */
  it('reports a write failure instead of swallowing it, and never throws into the draft path', async () => {
    executeRawMock.mockRejectedValue(new Error('remaining connection slots are reserved'))
    const collector = new PlayerMismatchCollector()
    collector.record({
      leagueId: 'lg_1',
      sport: 'NFL',
      reason: 'NO_SPORT_PLAYER_RECORD_MATCH',
      playerName: 'Justin Jefferson',
    })

    const result = await collector.flush()

    expect(result.ok).toBe(false)
    expect(logStructuredMock).toHaveBeenCalledWith(
      'error',
      'player_mismatch_logger',
      'flush_failed',
      expect.objectContaining({
        distinctFacts: 1,
        error: 'remaining connection slots are reserved',
      }),
    )
  })

  it('keeps player names out of the failure log', async () => {
    executeRawMock.mockRejectedValue(new Error('boom'))
    const collector = new PlayerMismatchCollector()
    collector.record({
      sport: 'NFL',
      reason: 'NO_SPORT_PLAYER_RECORD_MATCH',
      playerName: 'Justin Jefferson',
    })

    await collector.flush()

    const meta = logStructuredMock.mock.calls[0]?.[3]
    expect(JSON.stringify(meta)).not.toContain('Justin Jefferson')
  })
})

describe('summarizePlayerMismatchForAi', () => {
  it('returns prompt-ready one-liner with core fields', () => {
    const s = summarizePlayerMismatchForAi({
      sport: 'NFL',
      reason: 'ID_DRIFT_STRICT_MATCH_USED',
      playerName: 'Test Player',
      position: 'QB',
      team: 'DAL',
      poolExternalId: 'old-ext',
      attemptedMatchType: 'strict',
      confidence: 0.9,
    })
    expect(s).toContain('ID_DRIFT_STRICT_MATCH_USED')
    expect(s).toContain('sport=NFL')
    expect(s).toContain('player=Test Player')
    expect(s).toContain('confidence=0.9')
  })
})

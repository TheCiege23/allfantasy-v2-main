import { beforeEach, describe, expect, it, vi } from 'vitest'

/* `vi.mock` is hoisted above every top-level const, so the fns must be too. */
const { findUnique, create, correctionCreate } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  correctionCreate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueMaxPfFreeze: { findUnique, create },
    leagueMaxPfFreezeCorrection: { create: correctionCreate },
  },
}))

import {
  freezeMaxPf,
  readStoredMaxPfFreeze,
  recordMaxPfCorrection,
  type FreezeKey,
} from '@/lib/commissioner-os/efl/freezeStore'
import type { MaxPfFreezeSnapshot } from '@/lib/commissioner-os/efl/maxPfFreeze'

/**
 * Durable freeze persistence and the audited correction path.
 *
 * 🛑 THE CONTRACT: A FREEZE IS WRITTEN ONCE AND NEVER UPDATED. A value that silently refreshes on
 * every read is a cache, not a freeze, whatever the column is called.
 */

const KEY: FreezeKey = {
  leagueId: 'efl-1',
  season: 2026,
  metric: 'optimal_lineup_max_pf',
  computationVersion: 'maxpf-optimal-v1',
}

const SNAPSHOT: MaxPfFreezeSnapshot = {
  leagueId: 'efl-1',
  season: 2026,
  regularSeasonFinalWeek: 14,
  metric: 'optimal_lineup_max_pf',
  computationVersion: 'maxpf-optimal-v1',
  rows: [
    { teamId: 'a', value: 1400, weeksCounted: 14, source: 'weekly_rows' },
    { teamId: 'b', value: 1300, weeksCounted: 14, source: 'weekly_rows' },
  ],
  fingerprint: 'abc123',
}

function storedRow(over: Record<string, unknown> = {}) {
  return {
    id: 'freeze-1',
    leagueId: SNAPSHOT.leagueId,
    season: SNAPSHOT.season,
    regularSeasonFinalWeek: SNAPSHOT.regularSeasonFinalWeek,
    metric: SNAPSHOT.metric,
    computationVersion: SNAPSHOT.computationVersion,
    values: SNAPSHOT.rows,
    fingerprint: SNAPSHOT.fingerprint,
    createdAt: new Date('2026-12-30T00:00:00Z'),
    corrections: [],
    ...over,
  }
}

/** Prisma's "the migration has not been applied here" error. */
const tableMissing = Object.assign(new Error('table does not exist'), { code: 'P2021' })

beforeEach(() => {
  findUnique.mockReset()
  create.mockReset()
  correctionCreate.mockReset()
})

describe('it degrades rather than throwing while the migration is parked', () => {
  it('a missing table reads as "no freeze", not as an error', () => {
    /*
     * 🛑 THE MIGRATION IS PARKED IN prisma/migrations-pending/ AND APPLYING IT IS THE USER'S CALL.
     * Until then every Commissioner OS surface would error on this table if the read did not
     * degrade — and "not frozen yet" is the truthful answer in the meantime.
     */
    findUnique.mockRejectedValue(tableMissing)
    return expect(readStoredMaxPfFreeze(KEY)).resolves.toBeNull()
  })

  it('freezing reports not_persistable instead of pretending it worked', async () => {
    /*
     * ⚠ THE READ DEGRADES TO null, SO THE WRITE IS GENUINELY ATTEMPTED AND FAILS THERE. That is the
     * honest sequence and the test asserts it rather than a tidier one — an earlier version of this
     * test asserted `create` was never called, which described a code path that does not exist.
     */
    findUnique.mockRejectedValue(tableMissing)
    create.mockRejectedValue(tableMissing)

    const result = await freezeMaxPf({ snapshot: SNAPSHOT })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('not_persistable')
    expect(result.ok === false && result.detail).toMatch(/migrations-pending/)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('🛑 a REAL failure still throws — the catch is narrow on purpose', () => {
    /*
     * Swallowing a connection failure would turn a live outage into a permanent, quiet
     * "not frozen yet" that nobody investigates.
     */
    findUnique.mockRejectedValue(Object.assign(new Error('connection refused'), { code: 'P1001' }))
    return expect(readStoredMaxPfFreeze(KEY)).rejects.toThrow(/connection refused/)
  })
})

describe('the freeze is written once and a rerun does not mutate it', () => {
  it('creates when nothing is stored', async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(storedRow())
    create.mockResolvedValue({ id: 'freeze-1' })

    const result = await freezeMaxPf({ snapshot: SNAPSHOT, createdByUserId: 'u1' })
    expect(result.ok).toBe(true)
    expect(result.ok === true && result.created).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a normal rerun returns the existing freeze and writes NOTHING', async () => {
    findUnique.mockResolvedValue(storedRow())
    const result = await freezeMaxPf({ snapshot: SNAPSHOT })
    expect(result.ok === true && result.created).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('🛑 a rerun whose recomputation DISAGREES still writes nothing', async () => {
    /*
     * A stat correction moved a week-9 score. The stored freeze is the answer; the disagreement is
     * DRIFT for a human to look at, never an update to apply. The draft order does not move because
     * of somebody's Tuesday reprocessing.
     */
    findUnique.mockResolvedValue(storedRow())
    const drifted: MaxPfFreezeSnapshot = { ...SNAPSHOT, fingerprint: 'DIFFERENT', rows: [
      { teamId: 'a', value: 9999, weeksCounted: 14, source: 'weekly_rows' },
      { teamId: 'b', value: 1300, weeksCounted: 14, source: 'weekly_rows' },
    ] }
    const result = await freezeMaxPf({ snapshot: drifted })
    expect(result.ok === true && result.created).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(result.ok === true && result.stored.snapshot.rows.find((r) => r.teamId === 'a')!.value).toBe(1400)
  })

  it('a concurrent freeze that loses the unique-key race re-reads instead of failing', async () => {
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedRow())
    create.mockRejectedValue(Object.assign(new Error('unique constraint'), { code: 'P2002' }))

    const result = await freezeMaxPf({ snapshot: SNAPSHOT })
    expect(result.ok === true && result.created).toBe(false)
  })
})

describe('corrections are explicit, audited and append-only', () => {
  const correction = {
    id: 'corr-1',
    teamId: 'a',
    previousValue: 1400,
    value: 1450,
    reason: 'scoring appeal upheld',
    correctedByUserId: 'u1',
    correctedAt: new Date('2026-12-31T00:00:00Z'),
  }

  it('the effective value changes but the ORIGINAL stays recoverable', async () => {
    /*
     * 🛑 NOTHING UPDATES `values`. The effective snapshot is (computed + latest correction per team),
     * derived on read, which is what lets Commissioner OS answer "why did my pick move?".
     */
    findUnique.mockResolvedValue(storedRow({ corrections: [correction] }))
    const stored = await readStoredMaxPfFreeze(KEY)

    expect(stored!.snapshot.rows.find((r) => r.teamId === 'a')!.value).toBe(1450)
    expect(stored!.original.rows.find((r) => r.teamId === 'a')!.value).toBe(1400)
    expect(stored!.hasCorrection).toBe(true)
    expect(stored!.snapshot.fingerprint).not.toBe(stored!.original.fingerprint)
  })

  it('the corrected row is marked so provenance survives', async () => {
    findUnique.mockResolvedValue(storedRow({ corrections: [correction] }))
    const stored = await readStoredMaxPfFreeze(KEY)
    expect(stored!.snapshot.rows.find((r) => r.teamId === 'a')!.source).toBe('commissioner_correction')
    expect(stored!.snapshot.rows.find((r) => r.teamId === 'b')!.source).toBe('weekly_rows')
  })

  it('only the LATEST correction per team is effective, and the earlier one stays on the record', async () => {
    const later = { ...correction, id: 'corr-2', previousValue: 1450, value: 1500, correctedAt: new Date('2027-01-02T00:00:00Z') }
    findUnique.mockResolvedValue(storedRow({ corrections: [correction, later] }))
    const stored = await readStoredMaxPfFreeze(KEY)
    expect(stored!.snapshot.rows.find((r) => r.teamId === 'a')!.value).toBe(1500)
    expect(stored!.corrections).toHaveLength(2)
  })

  it('⚠ previousValue is READ from the record, never taken from the caller', async () => {
    /*
     * An audit trail whose before-value was asserted by the same person making the change is not an
     * audit trail. A stale UI, a retry or a copy-paste would all supply a wrong "previous".
     */
    findUnique.mockResolvedValue(storedRow())
    correctionCreate.mockResolvedValue({ id: 'corr-9' })

    await recordMaxPfCorrection({
      key: KEY,
      teamId: 'a',
      value: 1450,
      reason: 'appeal',
      correctedByUserId: 'u1',
    })
    expect(correctionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ previousValue: 1400, teamId: 'a' }) }),
    )
  })

  it('refuses a correction for a team that is not in the freeze', async () => {
    findUnique.mockResolvedValue(storedRow())
    const result = await recordMaxPfCorrection({
      key: KEY, teamId: 'ghost', value: 1, reason: 'r', correctedByUserId: 'u1',
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('unknown_team')
    expect(correctionCreate).not.toHaveBeenCalled()
  })

  it('refuses a correction with no reason', async () => {
    findUnique.mockResolvedValue(storedRow())
    const result = await recordMaxPfCorrection({
      key: KEY, teamId: 'a', value: 1, reason: '   ', correctedByUserId: 'u1',
    })
    expect(result.ok).toBe(false)
    expect(correctionCreate).not.toHaveBeenCalled()
  })

  it('refuses a correction when there is no freeze to correct', async () => {
    findUnique.mockResolvedValue(null)
    const result = await recordMaxPfCorrection({
      key: KEY, teamId: 'a', value: 1, reason: 'r', correctedByUserId: 'u1',
    })
    expect(result.ok === false && result.reason).toBe('no_freeze')
  })
})

/**
 * Regression guards for the 2026-09-19 create-league audit fixes.
 *
 * These are acceptance assertions, not characterization ones: each was run
 * against the pre-fix tree first and observed to FAIL, per the repo rule that a
 * check which has never gone red is not evidence.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { isNativePlatform, NATIVE_PLATFORM_VALUES } from '@/lib/dashboard/platform-label'

const db = vi.hoisted(() => ({ league: { findFirst: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const body = {
  concept: 'redraft', sport: 'NFL', teamCount: 12, draftType: 'snake',
  scoringPreset: 'fb_half_ppr', leagueName: 'Fix League', timezone: 'America/New_York',
  conceptSetup: { draftDate: '2026-10-01', draftTime: '20:00', draftTimezone: 'America/New_York', visibility: 'public' },
} as const

function txMock() {
  const models: Record<string, any> = {}
  let counter = 0
  return new Proxy(models, { get(target, model: string) {
    return target[model] ??= {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async (args: any) => ({ ...args.data, id: `${model}-${++counter}`, token: 'fix-token' })),
      createMany: vi.fn().mockResolvedValue({ count: 12 }),
      upsert: vi.fn().mockResolvedValue({ id: 'fix' }),
    }
  } })
}

async function createdLeagueData(payload: Record<string, unknown>) {
  const tx = txMock()
  await createCanonicalLeagueInTransaction(tx as any, 'fix-user', payload as any,
    runPresetEngine({ ...payload, commissionerId: 'fix-user' } as any))
  return tx.league.create.mock.calls[0][0].data
}

describe('playoff bracket can never exceed the manager count', () => {
  // 2 managers was the reported defect (it wrote 4). The larger sizes are the
  // control: the fix must not move brackets that were already correct.
  it.each([
    [2, 2],
    [3, 2],
    [6, 4],
    [12, 6],
  ])('a %i-manager league gets %i playoff places', async (teamCount, expected) => {
    const payload = { ...body, teamCount }
    expect(validateCreatePayload(payload).ok).toBe(true)
    const data = await createdLeagueData(payload)
    expect(data.playoffTeams).toBe(expected)
    expect(data.playoffTeams).toBeLessThanOrEqual(teamCount)
  })

  it('never seats an odd bracket', async () => {
    for (const teamCount of [2, 3, 5, 7, 9, 11]) {
      const data = await createdLeagueData({ ...body, teamCount })
      expect(data.playoffTeams % 2).toBe(0)
    }
  })
})

describe('natively created leagues are classified as native', () => {
  it('creation persists a platform the shared predicate calls native', () => {
    // The exact string createCanonicalLeagueInTransaction writes.
    expect(isNativePlatform('manual')).toBe(true)
    expect(NATIVE_PLATFORM_VALUES).toContain('manual')
  })

  it('the settings modal uses the shared predicate, not a second copy of the list', () => {
    const src = readFileSync(
      join(process.cwd(), 'app', 'league', '[leagueId]', 'components', 'LeagueSettingsModal.tsx'),
      'utf8',
    )
    expect(src).toContain('isNativePlatform')
    // The hand-copied list that omitted `manual` and sent every native league
    // to the read-only "imported from Manual" panel.
    expect(src).not.toMatch(/\[\s*'allfantasy',\s*'native',\s*'af',\s*''\s*\]/)
  })
})

describe('the chosen draft time is persisted as one canonical UTC instant', () => {
  const at = (date: string, time: string, zone: string) => ({
    ...body,
    conceptSetup: { ...body.conceptSetup, draftDate: date, draftTime: time, draftTimezone: zone },
  })

  async function settingsFor(payload: Record<string, unknown>) {
    const tx = txMock()
    await createCanonicalLeagueInTransaction(tx as any, 'fix-user', payload as any,
      runPresetEngine({ ...payload, commissionerId: 'fix-user' } as any))
    return tx.leagueSettings.create.mock.calls[0][0].data
  }

  it('stores a scheduled draft instead of leaving the column null', async () => {
    const data = await settingsFor(at('2026-10-15', '20:00', 'America/New_York'))
    expect(data.draftDateUtc).toBeInstanceOf(Date)
  })

  // The reason this must use `fromZonedTime` and not a fixed offset: US DST
  // ends 2026-11-01, so the SAME wall-clock time maps to a different instant
  // either side of it. NHL and NBA drafts straddle that date.
  it('converts correctly on both sides of the DST boundary', async () => {
    const edt = await settingsFor(at('2026-10-15', '20:00', 'America/New_York'))
    expect(edt.draftDateUtc.toISOString()).toBe('2026-10-16T00:00:00.000Z') // UTC-4

    const est = await settingsFor(at('2026-11-15', '20:00', 'America/New_York'))
    expect(est.draftDateUtc.toISOString()).toBe('2026-11-16T01:00:00.000Z') // UTC-5
  })

  it('honours a non-Eastern zone rather than assuming the league default', async () => {
    const data = await settingsFor(at('2026-10-15', '20:00', 'America/Los_Angeles'))
    expect(data.draftDateUtc.toISOString()).toBe('2026-10-16T03:00:00.000Z') // UTC-7
  })

  it('records null rather than a bad instant when the slot is unusable', async () => {
    const noTime = await settingsFor(at('2026-10-15', '', 'America/New_York'))
    expect(noTime.draftDateUtc).toBeNull()

    const badZone = await settingsFor(at('2026-10-15', '20:00', 'Not/AZone'))
    expect(badZone.draftDateUtc).toBeNull()
  })
})

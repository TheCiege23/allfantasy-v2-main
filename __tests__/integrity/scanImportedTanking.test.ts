import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueIntegritySettings: { findMany: m.findMany } } }))
vi.mock('@/lib/integrity/leagueEntitlement', () => ({ checkLeagueCommissionerEntitlement: vi.fn() }))
vi.mock('@/lib/integrity/integrityNotifier', () => ({ notifyCommissionerOfFlag: vi.fn() }))
vi.mock('@/lib/lineup-integrity/lineupIntegrityService', () => ({ readLineupIntegrity: vi.fn() }))

import {
  importedTankingScanMarkerKey,
  scanImportedLeagueForTanking,
  scanImportedLeaguesForTanking,
  type ImportedTankingScanDeps,
} from '@/lib/integrity/scanImportedTanking'
import type { LineupIntegrityReport } from '@/lib/lineup-integrity/lineupIntegrityService'

/**
 * The tanking monitor for imported Sleeper leagues: the latest finished week's lineup audit becomes a
 * flag — hard evidence only, once per week, one open case per manager.
 */
const finding = (over: Record<string, unknown> = {}) => ({
  week: 6,
  rosterId: '3',
  teamName: 'Bench Mob',
  emptySlots: 1,
  byeStarters: ['4034'],
  ruledOutStarters: [],
  text: 'Week 6: Bench Mob — 1 empty starting slot; started Christian McCaffrey on a bye.',
  flagged: true,
  playerNames: { '4034': 'Christian McCaffrey' },
  ...over,
})
const report = (findings = [finding()], latestWeek: number | null = 6): LineupIntegrityReport => ({
  supported: true,
  season: 2026,
  weeks: latestWeek == null ? [] : [latestWeek],
  latestWeek,
  requiredStarters: 9,
  findings: findings as never,
  summary: null,
  fullSeason: false,
  basis: '',
})

let deps: { [K in keyof ImportedTankingScanDeps]: ReturnType<typeof vi.fn> }
const run = () => scanImportedLeagueForTanking('L', deps as unknown as ImportedTankingScanDeps)

beforeEach(() => {
  vi.clearAllMocks()
  deps = {
    settings: vi.fn(async () => ({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingIllegalLineupCheck: true })),
    entitled: vi.fn(async () => true),
    report: vi.fn(async () => report()),
    record: vi.fn(async () => new Map([['3', { wins: 1, losses: 4 }]])),
    claim: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    hasOpenCase: vi.fn(async () => false),
    createFlag: vi.fn(async () => ({ id: 'flag-1' })),
    notify: vi.fn(async () => undefined),
    stampScan: vi.fn(async () => undefined),
  }
})

describe('scanImportedLeagueForTanking', () => {
  it('opens a tanking flag for a hard finding, names the players, and alerts the commissioner', async () => {
    expect(await run()).toEqual({ outcome: 'scanned', week: 6, flagged: 1 })
    expect(deps.claim).toHaveBeenCalledWith(importedTankingScanMarkerKey('L', 2026, 6))
    const data = deps.createFlag.mock.calls[0]![0]
    expect(data).toMatchObject({ leagueId: 'L', flagType: 'tanking', status: 'open', affectedRosterIds: ['3'], affectedTeamNames: ['Bench Mob'] })
    expect(data.summary).toContain('started Christian McCaffrey on a bye')
    expect(data.evidenceJson.currentRecord).toEqual({ wins: 1, losses: 4 })
    expect(data.evidenceJson.illegalOrSuspiciousStarters).toEqual([
      { slotPosition: 'STARTER', startedPlayerId: '4034', startedPlayerName: 'Christian McCaffrey', startedPlayerStatus: 'BYE' },
      { slotPosition: 'STARTER', startedPlayerId: '', startedPlayerName: 'Empty slot', startedPlayerStatus: 'EMPTY' },
    ])
    expect(deps.notify).toHaveBeenCalledWith('flag-1')
    expect(deps.stampScan).toHaveBeenCalledWith('L')
  })

  it('a soft-only finding (scored 0, listed Out today) is never a flag', async () => {
    deps.report.mockResolvedValue(report([finding({ emptySlots: 0, byeStarters: [], ruledOutStarters: ['9'], flagged: false })]))
    expect(await run()).toMatchObject({ outcome: 'scanned', flagged: 0 })
    expect(deps.createFlag).not.toHaveBeenCalled()
  })

  it('a week already scanned is not scanned again — a dismissed flag stays dismissed', async () => {
    deps.claim.mockResolvedValue(false)
    expect(await run()).toMatchObject({ outcome: 'already_scanned', flagged: 0 })
    expect(deps.createFlag).not.toHaveBeenCalled()
  })

  it('one open case per manager: an open flag is not stacked', async () => {
    deps.hasOpenCase.mockResolvedValue(true)
    expect(await run()).toMatchObject({ outcome: 'scanned', flagged: 0 })
    expect(deps.createFlag).not.toHaveBeenCalled()
  })

  it('respects the switches: monitor off, illegal-lineup check off, no plan, before the start week', async () => {
    deps.settings.mockResolvedValue({ tankingMonitorEnabled: false, tankingStartWeek: null, tankingIllegalLineupCheck: true })
    expect((await run()).outcome).toBe('not_monitored')
    deps.settings.mockResolvedValue({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingIllegalLineupCheck: false })
    expect((await run()).outcome).toBe('not_monitored')
    deps.settings.mockResolvedValue({ tankingMonitorEnabled: true, tankingStartWeek: 8, tankingIllegalLineupCheck: true })
    expect((await run()).outcome).toBe('before_start_week')
    deps.settings.mockResolvedValue({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingIllegalLineupCheck: true })
    deps.entitled.mockResolvedValue(false)
    expect((await run()).outcome).toBe('not_entitled')
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.createFlag).not.toHaveBeenCalled()
  })

  it('an unsupported league or one with no finished week claims nothing', async () => {
    deps.report.mockResolvedValue({ supported: false, reason: 'not_nfl' })
    expect((await run()).outcome).toBe('unsupported')
    deps.report.mockResolvedValue(report([], null))
    expect((await run()).outcome).toBe('no_finished_week')
    expect(deps.claim).not.toHaveBeenCalled()
  })

  it('a scan that throws releases its marker so the next pass retries', async () => {
    deps.createFlag.mockRejectedValue(new Error('db down'))
    await expect(run()).rejects.toThrow('db down')
    expect(deps.release).toHaveBeenCalledWith(importedTankingScanMarkerKey('L', 2026, 6))
  })

  it('a failed alert does not undo the flag', async () => {
    deps.notify.mockRejectedValue(new Error('mail down'))
    expect(await run()).toMatchObject({ outcome: 'scanned', flagged: 1 })
    expect(deps.release).not.toHaveBeenCalled()
  })
})

describe('scanImportedLeaguesForTanking', () => {
  it('scans every imported Sleeper league with the monitor on; one failure does not end the batch', async () => {
    m.findMany.mockResolvedValue([{ leagueId: 'A' }, { leagueId: 'B' }, { leagueId: 'C' }])
    const scanOne = vi.fn(async (id: string) => {
      if (id === 'B') throw new Error('boom')
      return { outcome: 'scanned' as const, week: 6, flagged: id === 'A' ? 2 : 0 }
    })
    expect(await scanImportedLeaguesForTanking({}, scanOne)).toEqual({ discovered: 3, scanned: 2, flagged: 2, failed: 1 })
    expect(m.findMany.mock.calls[0]![0].where).toMatchObject({
      tankingMonitorEnabled: true,
      league: { platform: { equals: 'sleeper', mode: 'insensitive' }, platformLeagueId: { not: '' } },
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueIntegritySettings: { findMany: m.findMany }, leagueTeam: { findFirst: vi.fn(async () => ({ teamName: 'Sleeper Seven', ownerName: null })) } } }))
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

let deps: { [K in keyof ImportedTankingScanDeps]-?: ReturnType<typeof vi.fn> }
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
    lineupScores: vi.fn(async () => new Map()),
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
    // Both checks off: nothing to run. (With only the illegal-lineup check off, the Lineup Integrity
    // pattern still runs — see the block below.)
    deps.settings.mockResolvedValue({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingIllegalLineupCheck: false, tankingBenchPatternCheck: false })
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
  it('scans every imported Sleeper and ESPN league with the monitor on; one failure does not end the batch', async () => {
    m.findMany.mockResolvedValue([{ leagueId: 'A' }, { leagueId: 'B' }, { leagueId: 'C' }])
    const scanOne = vi.fn(async (id: string) => {
      if (id === 'B') throw new Error('boom')
      return { outcome: 'scanned' as const, week: 6, flagged: id === 'A' ? 2 : 0 }
    })
    expect(await scanImportedLeaguesForTanking({}, scanOne)).toEqual({ discovered: 3, scanned: 2, flagged: 2, failed: 1 })
    expect(m.findMany.mock.calls[0]![0].where).toMatchObject({
      tankingMonitorEnabled: true,
      league: { OR: [{ platform: { equals: 'sleeper', mode: 'insensitive' } }, { platform: { equals: 'espn', mode: 'insensitive' } }], platformLeagueId: { not: '' } },
    })
  })
})

describe('the Lineup Integrity pattern for an imported Sleeper league', () => {
  const weeks = (...ratios: Array<number | null>) => ratios.map((ratio, i) => ({ week: i + 4, ratio, startedTopCount: 7, starterCount: 9, skipReason: ratio == null ? 'thin_projections' : null }))
  const scores = (rosterId: string, w: ReturnType<typeof weeks>) =>
    new Map([[rosterId, { thisWeek: { scored: true, ratio: w.at(-1)!.ratio, startedProj: 0, optimalProj: 0, startedTopCount: 7, starterCount: 9, excludedIds: [] }, weeks: w, snapshot: null }]])

  it('opens a case on a run of low weeks, says how it was scored, and names no single start', async () => {
    deps.report.mockResolvedValue(report([]))
    deps.lineupScores.mockResolvedValue(scores('7', weeks(0.95, 0.8, 0.82)))
    expect(await run()).toMatchObject({ outcome: 'scanned', flagged: 1 })
    const data = deps.createFlag.mock.calls[0][0]
    expect(data).toMatchObject({ flagType: 'tanking', affectedRosterIds: ['7'], severity: 'medium' })
    expect(data.summary).toBe('Started lineups well below the best available. Lineup Integrity under 85% of the best possible projection 2 weeks in a row.')
    expect(data.evidenceJson.lineupIntegrity).toMatchObject({ pattern: true, run: [5, 6], below: 0.85 })
    expect(data.evidenceJson.illegalOrSuspiciousStarters).toEqual([])
    expect(data.evidenceJson.redFlags.join(' ')).toMatch(/Sleeper’s own projections are not stored/)
    expect(deps.lineupScores).toHaveBeenCalledWith({ leagueId: 'L', season: 2026, week: 6 })
  })

  it('one low week is never a case', async () => {
    deps.report.mockResolvedValue(report([]))
    deps.lineupScores.mockResolvedValue(scores('7', weeks(0.95, 0.96, 0.6)))
    expect(await run()).toMatchObject({ flagged: 0 })
    expect(deps.createFlag).not.toHaveBeenCalled()
  })

  it('the pattern runs with the illegal-lineup check off, and not with the bench-pattern check off', async () => {
    deps.report.mockResolvedValue(report())
    deps.lineupScores.mockResolvedValue(scores('7', weeks(0.8, 0.8)))
    deps.settings.mockResolvedValue({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingIllegalLineupCheck: false })
    expect(await run()).toMatchObject({ outcome: 'scanned', flagged: 1 })
    // Only the pattern case — the hard finding for team 3 obeys the illegal-lineup switch.
    expect(deps.createFlag.mock.calls.map((c) => c[0].affectedRosterIds[0])).toEqual(['7'])

    vi.clearAllMocks()
    deps.claim.mockResolvedValue(true)
    deps.entitled.mockResolvedValue(true)
    deps.report.mockResolvedValue(report([]))
    deps.lineupScores.mockResolvedValue(scores('7', weeks(0.8, 0.8)))
    deps.settings.mockResolvedValue({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingIllegalLineupCheck: true, tankingBenchPatternCheck: false })
    expect(await run()).toMatchObject({ flagged: 0 })
    expect(deps.lineupScores).not.toHaveBeenCalled()
  })

  it('one open case per manager: a team flagged for hard evidence this week is not flagged twice', async () => {
    deps.report.mockResolvedValue(report())
    deps.lineupScores.mockResolvedValue(scores('3', weeks(0.8, 0.8)))
    let opened = false
    deps.hasOpenCase.mockImplementation(async () => opened)
    deps.createFlag.mockImplementation(async () => {
      opened = true
      return { id: 'flag-1' }
    })
    expect(await run()).toMatchObject({ flagged: 1 })
  })
})

describe('the scan for an imported ESPN league', () => {
  const weeks = (...ratios: number[]) => ratios.map((ratio, i) => ({ week: i + 4, ratio, startedTopCount: 7, starterCount: 9, skipReason: null }))
  it('keeps its own once-per-week marker and says the projections are not ESPN\u2019s', async () => {
    deps.report.mockResolvedValue({ ...report([]), scoresSource: 'espn' })
    deps.lineupScores.mockResolvedValue(
      new Map([['3', { thisWeek: { scored: true, ratio: 0.8, startedProj: 0, optimalProj: 0, startedTopCount: 7, starterCount: 9, excludedIds: [] }, weeks: weeks(0.8, 0.8), snapshot: null }]]),
    )
    expect(await run()).toMatchObject({ outcome: 'scanned', flagged: 1 })
    expect(deps.claim).toHaveBeenCalledWith(importedTankingScanMarkerKey('L', 2026, 6, 'espn'))
    expect(importedTankingScanMarkerKey('L', 2026, 6, 'espn')).not.toBe(importedTankingScanMarkerKey('L', 2026, 6))
    // Sleeper's key is unchanged, so no Sleeper week is ever scanned twice.
    expect(importedTankingScanMarkerKey('L', 2026, 6)).toBe('integrity-tanking-scan:L:sleeper:2026:6')
    expect(deps.createFlag.mock.calls[0][0].evidenceJson.redFlags.join(' ')).toMatch(/ESPN\u2019s own projections are not stored/)
  })
})

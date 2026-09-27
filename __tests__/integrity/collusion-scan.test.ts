/**
 * The post-trade collusion scan, converted (2026-09-27): it runs the trade review on the REAL trade,
 * flags on the review's own checks at the commissioner's sensitivity, and the AI only writes the note.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  leagueFind: vi.fn(),
  settingsFind: vi.fn(),
  settingsUpsert: vi.fn(),
  flagFind: vi.fn(),
  flagCreate: vi.fn(),
  afFind: vi.fn(),
  proposalFind: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: db.leagueFind },
    leagueIntegritySettings: { findUnique: db.settingsFind, upsert: db.settingsUpsert },
    integrityFlag: { findFirst: db.flagFind, create: db.flagCreate },
    afLeagueTrade: { findMany: db.afFind },
    redraftTradeProposal: { findMany: db.proposalFind },
  },
}))
vi.mock('@/lib/decision-os/trade/tradeReviewContext', () => ({ reviewStoredTrade: vi.fn() }))
vi.mock('@/lib/decision-os/trade/explainTrade', () => ({ explainTrade: vi.fn() }))
vi.mock('@/lib/integrity/integrityNotifier', () => ({ notifyCommissionerOfFlag: vi.fn() }))

import { collusionEvidence, fullLeagueCollusionScan, scanTradeForCollusion } from '@/lib/integrity/CollusionDetectionEngine'
import { collusionFlagsAtSensitivity, describeCollusionSensitivity } from '@/lib/integrity/sensitivity'

const NOW = new Date('2026-11-12T12:00:00.000Z')

const check = (code: string, severity: 'low' | 'medium' | 'high', status: 'raised' | 'clear' | 'not_computed', explanation = `${code} said so.`) => ({
  code,
  severity,
  status,
  explanation,
})

function reviewed(flags: Array<ReturnType<typeof check>>, extraChecks: Array<ReturnType<typeof check>> = []) {
  return {
    ok: true as const,
    review: { model: 'trade-review-v1', recommendation: 'consider_veto', flags, checks: [...flags, ...extraChecks] },
    receipt: {
      receiptId: 'rcpt_scan',
      grade: { graded: true, letter: 'F', partnerLetter: 'A', percentDiff: -48, giveValue: 6000, getValue: 3100 },
      assets: [
        { side: 'give', name: 'Star Runner', kind: 'player', leagueValue: 6000 },
        { side: 'get', name: 'Bench Guy', kind: 'player', leagueValue: 1600 },
        { side: 'get', name: '2027 Round 2', kind: 'pick', leagueValue: 1500 },
      ],
    },
    trade: { id: 'p1' },
    sideNames: ['Alpha', 'Bravo'] as [string, string],
    sides: [
      { teamId: 'rrA', rosterId: 'rA', gives: [{ kind: 'player', playerId: 'p1', name: 'Star Runner', position: 'RB' }] },
      { teamId: 'rrB', rosterId: 'rB', gives: [{ kind: 'player', playerId: 'p2', name: 'Bench Guy', position: 'WR' }] },
    ],
    facts: {
      history: { ok: true, value: [-22, -30, -48] },
      playoffPct: { ok: true, value: [0.5, 81] },
    },
  }
}

const HIGH = check('heavily_lopsided', 'high', 'raised', 'Bravo receives 48% more league value.')
const MEDIUM = check('repeat_partners', 'medium', 'raised', 'These two teams have made 3 trades this season, and every one favours Bravo.')
const LOW = check('deadline_rush', 'low', 'raised', 'Proposed 30 hours before the trade deadline with a 48% value gap.')

function deps(r: unknown, note: string | null = 'Flagged for the commissioner: a heavily lopsided value gap.') {
  return {
    review: vi.fn(async () => r) as never,
    explain: vi.fn(async () => ({ verdict: { commissioner: note ? { noteToLeague: note } : undefined } })) as never,
    notify: vi.fn(async () => undefined),
    now: () => NOW,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.leagueFind.mockResolvedValue({ userId: 'commish' })
  db.settingsFind.mockResolvedValue(null) // medium, the column default
  db.flagFind.mockResolvedValue(null)
  db.flagCreate.mockResolvedValue({ id: 'flag-1' })
  db.settingsUpsert.mockResolvedValue({})
  db.afFind.mockResolvedValue([])
  db.proposalFind.mockResolvedValue([])
})

describe('scanTradeForCollusion — the review, not a second engine', () => {
  it('reviews the real trade as the league commissioner, on its own surface', async () => {
    const d = deps(reviewed([HIGH]))
    await scanTradeForCollusion('L1', 'p1', { kind: 'redraft', proposalId: 'p1' }, d)
    expect(d.review).toHaveBeenCalledWith({ leagueId: 'L1', ref: { kind: 'redraft', proposalId: 'p1' }, userId: 'commish', surface: 'integrity-scan' })
  })

  it('files the raised flags as evidence, keyed on the real trade, and tells the commissioner', async () => {
    const d = deps(reviewed([HIGH, MEDIUM]))
    const out = await scanTradeForCollusion('L1', 'p1', { kind: 'redraft', proposalId: 'p1' }, d)
    expect(out.flags).toHaveLength(1)
    const data = db.flagCreate.mock.calls[0]![0].data
    expect(data).toMatchObject({
      flagType: 'collusion',
      severity: 'high',
      tradeTransactionId: 'p1',
      affectedRosterIds: ['rA', 'rB'],
      affectedTeamNames: ['Alpha', 'Bravo'],
      summary: 'Flagged for the commissioner: a heavily lopsided value gap.',
    })
    expect(data.evidenceJson).toMatchObject({
      reviewModel: 'trade-review-v1',
      receiptId: 'rcpt_scan',
      redFlags: [HIGH.explanation, MEDIUM.explanation],
      valueDifferentialPct: 48,
      team1TotalValue: 6000,
      team2TotalValue: 3100,
      priorTradesBetweenPair: 2,
      isPlayoffContender: { team1: false, team2: true },
    })
    expect(d.notify).toHaveBeenCalledWith('flag-1')
  })

  it('a clean review files nothing — and never asks the model', async () => {
    const d = deps(reviewed([], [check('heavily_lopsided', 'high', 'clear')]))
    const out = await scanTradeForCollusion('L1', 'p1', { kind: 'af', tradeId: 'p1' }, d)
    expect(out.flags).toEqual([])
    expect(db.flagCreate).not.toHaveBeenCalled()
    expect(d.explain).not.toHaveBeenCalled()
  })

  it('a check that could not run is never a flag', async () => {
    const d = deps(reviewed([], [check('eliminated_team_dumping', 'medium', 'not_computed')]))
    await scanTradeForCollusion('L1', 'p1', { kind: 'af', tradeId: 'p1' }, d)
    expect(db.flagCreate).not.toHaveBeenCalled()
  })

  it("the commissioner's sensitivity picks which review flags open a case — it moves no threshold", async () => {
    db.settingsFind.mockResolvedValue({ collusionSensitivity: 'low' })
    await scanTradeForCollusion('L1', 'p1', { kind: 'af', tradeId: 'p1' }, deps(reviewed([MEDIUM])))
    expect(db.flagCreate).not.toHaveBeenCalled()

    db.settingsFind.mockResolvedValue({ collusionSensitivity: 'high' })
    await scanTradeForCollusion('L1', 'p1', { kind: 'af', tradeId: 'p1' }, deps(reviewed([LOW])))
    expect(db.flagCreate).toHaveBeenCalledTimes(1)
    expect(db.flagCreate.mock.calls[0]![0].data.severity).toBe('low')
  })

  it('with no model, the note is the review in its own words', async () => {
    await scanTradeForCollusion('L1', 'p1', { kind: 'af', tradeId: 'p1' }, deps(reviewed([HIGH]), null))
    expect(db.flagCreate.mock.calls[0]![0].data.summary).toBe(`Flagged for the commissioner: ${HIGH.explanation}`)
  })

  it('an open flag on the trade is not duplicated', async () => {
    db.flagFind.mockResolvedValue({ id: 'existing' })
    await scanTradeForCollusion('L1', 'p1', { kind: 'af', tradeId: 'p1' }, deps(reviewed([HIGH])))
    expect(db.flagCreate).not.toHaveBeenCalled()
  })

  it('a job queued before the conversion (no trade reference) is skipped, not guessed at', async () => {
    const d = deps(reviewed([HIGH]))
    const out = await scanTradeForCollusion('L1', 'legacy-row', undefined, d)
    expect(out.flags).toEqual([])
    expect(d.review).not.toHaveBeenCalled()
  })

  it('a trade the review refuses files nothing, and the scan still records that it ran', async () => {
    const d = deps({ ok: false, refusal: { code: 'not_found', reason: 'gone' } })
    await scanTradeForCollusion('L1', 'p1', { kind: 'af', tradeId: 'p1' }, d)
    expect(db.flagCreate).not.toHaveBeenCalled()
    expect(db.settingsUpsert).toHaveBeenCalledTimes(1)
  })
})

describe('fullLeagueCollusionScan', () => {
  it('scans settled native AND redraft trades, skipping ones already flagged', async () => {
    db.afFind.mockResolvedValue([{ id: 'af1' }])
    db.proposalFind.mockResolvedValue([{ id: 'rp1' }, { id: 'rp2' }])
    db.flagFind.mockImplementation(async (args: { where: { tradeTransactionId: string; status?: string } }) =>
      args.where.tradeTransactionId === 'rp2' && !args.where.status ? { id: 'old' } : null,
    )
    const d = deps(reviewed([]))
    await fullLeagueCollusionScan('L1', d)
    expect((d.review as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].ref)).toEqual([
      { kind: 'af', tradeId: 'af1' },
      { kind: 'redraft', proposalId: 'rp1' },
    ])
  })
})

describe('collusionEvidence', () => {
  it('omits what the review could not read rather than inventing it', () => {
    const r = reviewed([HIGH])
    const ev = collusionEvidence('p1', { ...r, facts: { history: { ok: false, reason: 'x' }, playoffPct: { ok: false, reason: 'y' } } } as never)
    expect(ev).not.toHaveProperty('priorTradesBetweenPair')
    expect(ev).not.toHaveProperty('isPlayoffContender')
    expect(ev.assetsTeam1Gave).toEqual([{ name: 'Star Runner', position: 'RB', estimatedValue: 6000 }])
    expect(ev.assetsTeam2Gave.map((a) => a.position)).toEqual(['WR', 'PICK'])
  })
})

describe('collusion sensitivity', () => {
  const flags = [HIGH, MEDIUM, LOW]
  it('low → high only; medium → high and medium; high → every flag', () => {
    expect(collusionFlagsAtSensitivity(flags, 'low').map((f) => f.code)).toEqual(['heavily_lopsided'])
    expect(collusionFlagsAtSensitivity(flags, 'medium').map((f) => f.code)).toEqual(['heavily_lopsided', 'repeat_partners'])
    expect(collusionFlagsAtSensitivity(flags, 'high')).toHaveLength(3)
  })

  it('the sentence under the control names the flags each level opens, and no percentage it does not use', () => {
    expect(describeCollusionSensitivity('low')).toMatch(/lopsided value gap or a tanking signal/)
    expect(describeCollusionSensitivity('medium')).toMatch(/inactive manager/)
    expect(describeCollusionSensitivity('high')).toMatch(/deadline/)
    for (const l of ['low', 'medium', 'high'] as const) expect(describeCollusionSensitivity(l)).not.toMatch(/%/)
  })
})

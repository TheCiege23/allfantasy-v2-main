import { describe, it, expect } from 'vitest'
import {
  deriveAll,
  derivePlatform,
  deriveDraft,
  deriveManager,
  reconcileAgainstManifest,
  pseudoRef,
} from '@/lib/fantasy-os/exec-intelligence/derive'
import { isRenderableInsight, confidenceFromSampleSize } from '@/lib/fantasy-os/exec-intelligence/explanation'
import { EXEC_OFFSEASON_LIMITATION } from '@/lib/fantasy-os/exec-intelligence/truth'
import type { ExecSnapshot, ExecLeagueRow, ExecManagerRow } from '@/lib/fantasy-os/exec-data/types'

const L = (over: Partial<ExecLeagueRow>): ExecLeagueRow => ({
  leagueId: 'x', season: '2025', name: 'n', status: 'complete', totalRosters: 12, previousLeagueId: null,
  isMembership: true, formatType: 'dynasty', seedRole: 'member', scoringKeys: 40, rosterPositions: [],
  users: 12, rosters: 12, commissioners: 1, drafts: 1, draftPicks: 100, tradedFuturePicks: 0,
  matchupRecords: 200, weeksWithMatchups: 18, transactions: 0, trades: 0, waivers: 0, freeAgents: 0, faab: 0,
  hasWinnersBracket: true, hasLosersBracket: true, ...over,
})
const M = (over: Partial<ExecManagerRow>): ExecManagerRow => ({
  userId: 'u', displayName: 'd', isCommissioner: false, leagueCount: 1, seasonCount: 1, teamNames: [], ...over,
})

const leagues: ExecLeagueRow[] = [
  L({ leagueId: 'L1', season: '2025', seedRole: 'commissioner', trades: 10, waivers: 20, freeAgents: 5, faab: 20, transactions: 35, draftPicks: 100, matchupRecords: 200, tradedFuturePicks: 3, rosters: 12 }),
  L({ leagueId: 'L2', season: '2025', formatType: 'redraft', trades: 0, waivers: 0, freeAgents: 0, faab: 0, transactions: 0, draftPicks: 120, matchupRecords: 180, rosters: 10 }),
  L({ leagueId: 'L3', season: '2024', trades: 40, waivers: 30, freeAgents: 10, faab: 30, transactions: 80, draftPicks: 90, matchupRecords: 150, tradedFuturePicks: 5, rosters: 14 }),
]
const managers: ExecManagerRow[] = [
  M({ userId: 'M1', isCommissioner: true, leagueCount: 3, seasonCount: 2 }),
  M({ userId: 'M2', leagueCount: 1, seasonCount: 1 }),
  M({ userId: 'M3', leagueCount: 2, seasonCount: 2 }),
]

const snapshot: ExecSnapshot = {
  run: {
    runId: 'run1', manifestHash: 'hash1', seedUserId: 'seed', seedUsername: 'theciege24',
    generatedAt: '2026-07-11T00:00:00Z', schemaVersion: 'fos_phase4.v1', calcVersion: 'discovery.v1',
    importedAt: '2026-07-11T20:00:00Z', seasons: ['2024', '2025'],
    totals: {
      leagueSeasons: 3, uniqueRealManagers: 3, commissioners: 1, transactions: 115, trades: 50, waivers: 50,
      freeAgents: 15, faab: 50, drafts: 3, draftPicks: 310, matchupRecords: 530, tradedFuturePicks: 8, rosters: 36,
    },
    api: { calls: 100, ok: 100, fail: 0, notFound: 0 }, warnings: [],
  },
  leagues, managers, continuityChainCount: 1,
}

describe('exec-intelligence derivations', () => {
  it('platform totals are deterministic sums of the snapshot', () => {
    const p = derivePlatform(snapshot, 'fixed')
    expect(p.totals).toMatchObject({ leagueSeasons: 3, uniqueManagers: 3, commissioners: 1, transactions: 115, trades: 50, waivers: 50, freeAgents: 15, faab: 50, drafts: 3, draftPicks: 310, matchups: 530, tradedFuturePicks: 8, rosters: 36 })
  })

  it('reconciles derived totals against the certified manifest (all match)', () => {
    const rows = reconcileAgainstManifest(snapshot)
    expect(rows.every((r) => r.match)).toBe(true)
    expect(rows).toHaveLength(13)
  })

  it('carries the source/freshness envelope with the 2024–2025 window', () => {
    const p = derivePlatform(snapshot, 'fixed')
    expect(p.source).toMatchObject({ manifestHash: 'hash1', runId: 'run1', seasons: [2024, 2025] })
    expect(p.freshness).toMatchObject({ sourceWindowStart: '2024', sourceWindowEnd: '2025' })
  })

  it('assigns the primary truth label per surface', () => {
    const all = deriveAll(snapshot, 'fixed')
    expect(all.platform.truthLabel).toBe('Live League Data')
    expect(all.league.truthLabel).toBe('Derived League Intelligence')
    expect(all.trade.truthLabel).toBe('Derived League Intelligence')
    expect(all.manager.truthLabel).toBe('Derived League Intelligence')
  })

  it('every produced insight satisfies the explanation contract (renderable)', () => {
    const all = deriveAll(snapshot, 'fixed')
    for (const c of Object.values(all)) {
      for (const insight of c.insights) expect(isRenderableInsight(insight)).toBe(true)
    }
  })

  it('rejects an incomplete explanation (missing evidence/recommendation)', () => {
    expect(isRenderableInsight({ whatHappened: 'x', evidence: [], whyItMatters: 'y', recommendation: 'z', confidence: { level: 'High', rationale: 'r' }, truthLabel: 'Derived League Intelligence' })).toBe(false)
    expect(isRenderableInsight({ whatHappened: 'x', evidence: [{ metric: 'm', value: 1 }], whyItMatters: 'y', recommendation: '', confidence: { level: 'High', rationale: 'r' }, truthLabel: 'Live League Data' })).toBe(false)
  })

  it('confidence scales with sample size deterministically', () => {
    expect(confidenceFromSampleSize(500).level).toBe('High')
    expect(confidenceFromSampleSize(50).level).toBe('Medium')
    expect(confidenceFromSampleSize(5).level).toBe('Low')
  })

  it('classifies league operational health by the explicit transaction rule', () => {
    const all = deriveAll(snapshot, 'fixed')
    const h = Object.fromEntries(all.league.operationalHealth.map((x) => [x.status, x.count]))
    expect(h).toEqual({ active: 1, quiet: 1, dormant: 1 }) // L3=80 active, L1=35 quiet, L2=0 dormant
  })

  it('draft positional distribution is Insufficient Evidence (never guessed)', () => {
    const d = deriveDraft(snapshot, 'fixed')
    expect(d.positionalDistributionAvailable).toBe(false)
    expect(d.avgPicksPerDraft).toBeCloseTo(103.3, 1)
  })

  it('waiver FAAB adoption uses a valid denominator', () => {
    const w = deriveAll(snapshot, 'fixed').waiver
    expect(w.faabAdoptionPct).toBe(100) // 2 faab leagues / 2 waiver-active leagues
  })

  it('trade YoY is deterministic', () => {
    const t = deriveAll(snapshot, 'fixed').trade
    expect(t.yoyChangePct).toBe(-75) // 2025:10 vs 2024:40
  })

  it('manager intelligence forbids psychological/retention inference', () => {
    const m = deriveManager(snapshot, 'fixed')
    expect(m.forbiddenInferences).toEqual(expect.arrayContaining(['psychology', 'churn probability', 'retention intent', 'willingness to pay', 'skill rating']))
    expect(m.managersInMultipleLeagues).toBe(2)
    expect(m.participationDistribution.reduce((a, d) => a + d.count, 0)).toBe(3)
  })

  it('discloses the offseason limitation on transaction-derived surfaces', () => {
    const all = deriveAll(snapshot, 'fixed')
    expect(all.platform.limitations).toContain(EXEC_OFFSEASON_LIMITATION)
    expect(all.trade.insights[0].limitations).toContain(EXEC_OFFSEASON_LIMITATION)
  })

  it('pseudoRef is deterministic and never leaks the raw id', () => {
    expect(pseudoRef('L1', 'lg')).toBe(pseudoRef('L1', 'lg'))
    expect(pseudoRef('L1', 'lg')).not.toContain('L1')
    expect(pseudoRef('L1', 'lg')).toMatch(/^lg-[0-9a-z]{6}$/)
  })
})

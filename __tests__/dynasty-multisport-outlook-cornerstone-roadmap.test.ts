/**
 * @vitest-environment node
 *
 * Dynasty surfaces outside the War Room that only knew football:
 * - My Team's dynasty outlook flagged aging only for QB/RB/WR/TE and read ages by Sleeper id with
 *   no sport filter.
 * - The trade engine's cornerstone rules were QB/TE/WR/RB-only, so no MLB/NBA/NHL player could be one.
 * - The dynasty-roadmap prompt was "dynasty fantasy football strategist" with SF/1QB for every league.
 * NFL behaviour is pinned in each case.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ ageWhere: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        db.ageWhere = args.where
        return [{ sleeperId: 'p1', age: 34 }]
      }),
    },
    leagueTeam: { findMany: vi.fn(async () => []) },
    roster: { findFirst: vi.fn(async () => null) },
    futureDraftPick: { findMany: vi.fn(async () => []) },
    draftFact: { groupBy: vi.fn(async () => []) },
  },
}))

import { AGING_FROM, agingThreshold, loadDynastyOutlook, summariseAges } from '@/lib/core-app/dynastyOutlook'
import { getPeakAgeRange } from '@/lib/dynasty-engine/SportDynastyResolver'
import { classifyCornerstone } from '@/lib/trade-engine/league-intelligence'
import { classifyCornerstone as classifyCornerstoneTiers, defaultThresholds } from '@/lib/trade-engine/dynasty-tiers'
import { DEFAULT_THRESHOLDS, type Asset, type LeagueSettings } from '@/lib/trade-engine/types'
import { buildDynastyRoadmapPrompt } from '@/lib/rankings-engine/dynastyRoadmapPrompt'

const P = (sleeperId: string, position: string) => ({ sleeperId, name: sleeperId, position })

describe('dynasty outlook aging is sport-aware', () => {
  it('NFL thresholds are unchanged', () => {
    expect(AGING_FROM).toEqual({ QB: 34, RB: 27, WR: 29, TE: 30 })
    for (const [pos, age] of Object.entries(AGING_FROM)) {
      expect(agingThreshold('NFL', pos)).toBe(age)
      expect(agingThreshold(null, pos)).toBe(age)
    }
    expect(agingThreshold('NFL', 'K')).toBeUndefined()
  })

  it.each([
    ['NBA', 'PG'],
    ['MLB', 'SP'],
    ['NHL', 'G'],
  ])('%s %s gets a threshold just past its peak', (sport, pos) => {
    expect(agingThreshold(sport, pos)).toBe(getPeakAgeRange(sport, pos).peakEnd + 1)
  })

  it('an aging NBA starter is flagged (it never was before)', () => {
    const starters = [P('old', 'PG'), P('young', 'C')]
    const ages = new Map([
      ['old', 36],
      ['young', 22],
    ])
    const out = summariseAges(starters, starters, ages, 'NBA')
    if (!out.available) throw new Error('expected ages')
    expect(out.aging.map((a) => a.sleeperId)).toEqual(['old'])
    // Without a sport the NFL table runs and a PG is never flagged — the old behaviour.
    const nfl = summariseAges(starters, starters, ages)
    if (!nfl.available) throw new Error('expected ages')
    expect(nfl.aging).toEqual([])
  })

  it('the age lookup is scoped to the league’s sport', async () => {
    const out = await loadDynastyOutlook({
      league: { id: 'L', platform: 'sleeper', leagueType: 'dynasty', isDynasty: true, season: 2026, status: null, sport: 'NBA' },
      teamExternalId: null,
      rosterCandidates: [],
      starters: [P('p1', 'PG')],
      roster: [P('p1', 'PG')],
    })
    expect(db.ageWhere).toMatchObject({ sleeperId: { in: ['p1'] }, sport: { in: expect.arrayContaining(['NBA', 'nba']) } })
    expect(out.ages.available && out.ages.aging.map((a) => a.sleeperId)).toEqual(['p1'])
  })

  it('without a sport the lookup is the old unscoped one', async () => {
    await loadDynastyOutlook({
      league: { id: 'L', platform: 'sleeper', leagueType: 'dynasty', isDynasty: true, season: 2026, status: null },
      teamExternalId: null,
      rosterCandidates: [],
      starters: [P('p1', 'QB')],
      roster: [P('p1', 'QB')],
    })
    expect(db.ageWhere).toEqual({ sleeperId: { in: ['p1'] }, age: { not: null } })
  })
})

function asset(pos: string, value: number, extra: Partial<Asset> = {}): Asset {
  return { id: `a-${pos}-${value}`, type: 'PLAYER', value, name: 'X', pos, ...extra } as Asset
}
function settings(extra: Partial<LeagueSettings> = {}): LeagueSettings {
  return {
    leagueName: 'L', scoringType: 'PPR', numTeams: 12, isTEP: false, tepBonus: 0, isSF: false,
    rosterPositions: [], starterSlots: 10, benchSlots: 10, taxiSlots: 0, ...extra,
  } as LeagueSettings
}

describe('cornerstones exist in every sport', () => {
  beforeEach(() => {
    db.ageWhere = null
  })

  it.each([
    ['nba', 'C'],
    ['mlb', 'SP'],
    ['mlb', 'SS'],
    ['nhl', 'D'],
  ])('%s %s at an elite value is a cornerstone', (sport, pos) => {
    const s = settings({ sport: sport as LeagueSettings['sport'], idpEnabled: true })
    const out = classifyCornerstone(asset(pos, DEFAULT_THRESHOLDS.SKILL_CORNERSTONE), s)
    expect(out.isCornerstone).toBe(true)
    expect(out.cornerstoneReason).toBe(`Elite ${sport.toUpperCase()} cornerstone.`)
    expect(classifyCornerstone(asset(pos, DEFAULT_THRESHOLDS.SKILL_CORNERSTONE - 1), s).isCornerstone).toBe(false)
    const tiers = classifyCornerstoneTiers(asset(pos, 9500), { ...s, sport }, defaultThresholds())
    expect(tiers.isCornerstone).toBe(true)
  })

  it('NFL rules are unchanged', () => {
    expect(classifyCornerstone(asset('QB', 8000), settings({ isSF: true })).isCornerstone).toBe(true)
    expect(classifyCornerstone(asset('QB', 8000), settings()).isCornerstone).toBe(false)
    expect(classifyCornerstone(asset('WR', 9000), settings({ sport: 'nfl' })).cornerstoneReason).toBe('Elite skill cornerstone.')
    expect(classifyCornerstone(asset('C', 9999), settings({ sport: 'nfl' })).isCornerstone).toBe(false)
    expect(classifyCornerstone(asset('LB', 4200), settings({ idpEnabled: true })).isCornerstone).toBe(true)
    expect(classifyCornerstoneTiers(asset('TE', 8000), settings(), defaultThresholds()).cornerstoneReason).toBe('Elite TE cornerstone.')
    expect(classifyCornerstoneTiers(asset('PG', 9999), settings(), defaultThresholds()).isCornerstone).toBe(false)
  })
})

/** Frozen copy of the original route prompt, for the NFL equivalence check. */
function legacyPrompt(i: {
  leagueType: string; isSF: boolean; goal: string; leagueName?: string; avgAge: number; totalValue: number
  agingAssets: number; agingPct: number; youngCore: number; youngPct: number; posStrengthStr: string
  weakPosStr: string; topAssetsStr: string; totalPlayers: number
}): string {
  return `You are a dynasty fantasy football strategist. Generate a 3-5 year dynasty roadmap based strictly on the computed roster data below. Be motivational but honest.

ROSTER DATA:
- League: ${i.leagueType}${i.isSF ? ' Superflex' : ' 1QB'}${i.leagueName ? ` (${i.leagueName})` : ''}
- Goal: ${i.goal}
- Average Roster Age: ${i.avgAge.toFixed(1)}
- Total Roster Value: ${i.totalValue.toLocaleString()}
- Aging Assets (29+): ${i.agingAssets} players (${i.agingPct}%)
- Young Core (24-): ${i.youngCore} players (${i.youngPct}%)
- Position Strengths: ${i.posStrengthStr}
- Weak Positions: ${i.weakPosStr || 'None identified'}
- Top Assets: ${i.topAssetsStr}
- Total Roster Size: ${i.totalPlayers}

RULES:
1. Every recommendation MUST reference specific roster data above (age distribution, position strengths, weak positions).
2. Do NOT invent player names or stats not provided.
3. Each year plan should have 2-4 concrete priorities.
4. Be motivational - frame challenges as opportunities.
5. If the roster is already strong, acknowledge it and suggest maintenance strategies.
6. Consider the ${i.isSF ? 'Superflex' : '1QB'} format in QB valuation.
7. Factor in the user's stated goal of "${i.goal}".

Return a JSON object with this exact structure:
{
  "horizon": "3-Year Plan" or "5-Year Plan",
  "currentPhase": one of "Contending" | "Retooling" | "Rebuilding" | "Emerging",
  "overallStrategy": "1-2 sentence summary",
  "yearPlans": [
    {
      "year": 1,
      "label": "Year 1: [Theme]",
      "priorities": ["priority 1", "priority 2"],
      "targetPositions": ["QB", "RB"],
      "keyMoves": ["Specific actionable move 1", "Specific actionable move 2"]
    }
  ],
  "riskFactors": ["risk 1", "risk 2"],
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}`
}

describe('dynasty roadmap prompt is sport-aware', () => {
  const base = {
    leagueType: 'Dynasty', goal: 'compete', avgAge: 26.4, totalValue: 123456, agingAssets: 2, agingPct: 20,
    youngCore: 3, youngPct: 30, posStrengthStr: 'PG: 80/100', weakPosStr: 'C', topAssetsStr: 'PG group', totalPlayers: 10,
  }

  it('NFL (and no sport) is byte-identical to the original prompt', () => {
    for (const isSF of [true, false]) {
      for (const leagueName of [undefined, 'My League']) {
        const input = { ...base, isSF, leagueName }
        expect(buildDynastyRoadmapPrompt(input)).toBe(legacyPrompt(input))
        expect(buildDynastyRoadmapPrompt({ ...input, sport: 'NFL' })).toBe(legacyPrompt(input))
        expect(buildDynastyRoadmapPrompt({ ...input, sport: 'nfl' })).toBe(legacyPrompt(input))
      }
    }
  })

  it.each([
    ['NBA', 'basketball'],
    ['MLB', 'baseball'],
    ['NHL', 'hockey'],
  ])('%s names %s and drops football/QB framing', (sport, label) => {
    const prompt = buildDynastyRoadmapPrompt({ ...base, isSF: true, sport })
    expect(prompt).toContain(`dynasty fantasy ${label} strategist`)
    expect(prompt).not.toContain('football')
    expect(prompt).not.toContain('Superflex')
    expect(prompt).not.toContain('1QB')
    expect(prompt).not.toContain('QB valuation')
    expect(prompt).not.toContain('["QB", "RB"]')
  })
})

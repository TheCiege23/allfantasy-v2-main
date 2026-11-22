/**
 * Spanish for the dynasty engine's explanation sentences (lib/core-app/dynastyFactsSpanish.ts).
 *
 * 🛑 THE GUARD RUNS THE REAL ENGINE. A hand-written list of English sentences would only prove the
 * translator matches what this test's author typed. Instead `evaluateDynastyTeamDirection` is run on
 * rosters that make it emit every fact it can, and EVERY sentence it returns must be recognised — so if
 * the engine's wording changes, this goes red rather than Spanish readers quietly getting English.
 */

import { describe, expect, it } from 'vitest'

import { evaluateDynastyTeamDirection } from '@/lib/dynasty-war-room/dynastyTeamDirectionEngine'
import type { DynastyFuturePick, DynastyPlayerFact, DynastyTeamSummary, DynastyWarRoomContext } from '@/lib/dynasty-war-room/types'
import { dynastyFactSentence, isKnownDynastyFact } from '@/lib/core-app/dynastyFactsSpanish'

const player = (id: string, position: string, age: number, dynastyValue: number, starter = true): DynastyPlayerFact => ({
  playerId: id,
  playerName: `P${id}`,
  position,
  team: 'TM',
  slotType: starter ? 'starter' : 'bench',
  isStarterSlot: starter,
  age,
  dynastyValue,
  adp: null,
  injuryStatus: null,
  weekProjection: null,
  hasNoValueSignal: false,
})

const pick = (id: string, season: number, round: number): DynastyFuturePick => ({
  id,
  season,
  round,
  originalRosterId: 'r1',
  currentOwnerId: 'r1',
  traded: false,
  status: 'active',
  estValue: round === 1 ? 40 : 15,
})

const team = (over: Partial<DynastyTeamSummary>): DynastyTeamSummary => ({
  rosterId: 'r1',
  ownerId: 'o1',
  ownerName: 'Me',
  teamName: 'Mine',
  wins: 3,
  losses: 6,
  ties: 1,
  pointsFor: 900,
  playoffSeed: null,
  isUserTeam: true,
  players: [player('a', 'QB', 31, 5000), player('b', 'RB', 22, 7000), player('c', 'WR', 28, 6000), player('d', 'TE', 30, 3000)],
  picks: [pick('p1', 2027, 1), pick('p2', 2027, 2), pick('p3', 2028, 1)],
  ...over,
})

function ctx(teams: DynastyTeamSummary[], picks: 'available' | 'missing' = 'available'): DynastyWarRoomContext {
  return {
    leagueId: 'lg',
    leagueType: 'dynasty',
    sport: 'NFL',
    season: 2026,
    scoring: { sport: 'NFL', scoringPreset: 'PPR', superflex: false, tePremium: false },
    roster: { totalStarterSlots: 4, benchSlots: 6, taxiSlots: 0, irSlots: 0, requiredByPosition: { QB: 1, RB: 1, WR: 1, TE: 1 } },
    userRosterId: 'r1',
    isCommissioner: false,
    teams,
    freeAgents: [],
    rookieDraftWindows: [],
    availability: {
      scoringRules: 'available',
      rosterRules: 'available',
      standings: 'available',
      rosters: 'available',
      playerValues: 'available',
      playerAges: 'available',
      futurePicks: picks,
      injuries: 'available',
      news: 'available',
      projections: 'missing',
      freeAgentPool: 'available',
    },
    freshness: { generatedAt: '2026-11-12T00:00:00.000Z', valuesAsOf: null, injuriesAsOf: null },
    missingDataFlags: [],
    featureAvailability: { teamDirection: true, rosterNeeds: true, tradeAnalyze: true, tradeFind: true, buySellHold: true, waivers: true, lineup: true, pickValue: true },
  } as DynastyWarRoomContext
}

/** Every fact the real engine emits across rosters chosen to trigger each template. */
function engineFacts(): string[] {
  const out = new Set<string>()
  for (const t of [team({}), team({ ties: 0, picks: [pick('x', 2027, 3)] })]) {
    for (const f of evaluateDynastyTeamDirection(ctx([t]), 'r1').explanationFacts) out.add(f)
  }
  for (const f of evaluateDynastyTeamDirection(ctx([team({})]), 'missing-roster').explanationFacts) out.add(f)
  return [...out]
}

describe('dynastyFactSentence — every sentence the real engine emits', () => {
  it('the engine produces every template under test (record with a tie, young share, age, picks, no roster)', () => {
    const facts = engineFacts()
    expect(facts.some((f) => f.startsWith('Record 3-6-1'))).toBe(true)
    expect(facts.some((f) => f.startsWith('Young-asset value share'))).toBe(true)
    expect(facts.some((f) => f.startsWith('Average starter age'))).toBe(true)
    expect(facts.some((f) => f.startsWith('Pick capital:'))).toBe(true)
    expect(facts).toContain('Roster not found in this league.')
  })

  it('🛑 recognises every one — a new engine wording turns this red instead of shipping English to Spanish readers', () => {
    const unknown = engineFacts().filter((f) => !isKnownDynastyFact(f))
    expect(unknown).toEqual([])
  })

  it('translates each into Spanish with no English left over', () => {
    for (const f of engineFacts()) {
      const es = dynastyFactSentence(f, 'es')
      expect(es).not.toBe(f)
      expect(es).not.toMatch(/\b(Record|Young-asset|Average starter|Pick capital|future pick|early|Roster not found)\b/)
    }
  })
})

describe('dynastyFactSentence — exact wording', () => {
  it.each([
    ['Record 3-6-1 (win% 0.35).', 'Récord 3-6-1 (porcentaje de victorias 0.35).'],
    ['Record 7-2 (win% 0.78).', 'Récord 7-2 (porcentaje de victorias 0.78).'],
    ['Young-asset value share 22% (sustainability signal).', 'El 22% del valor está en activos jóvenes (señal de sostenibilidad).'],
    ['Average starter age 28.4.', 'Edad promedio de los titulares: 28.4.'],
    ['Pick capital: 3 future pick(s), 2 early, tier total 95.', 'Capital de selecciones: 3 selecciones futuras, 2 tempranas, valor total por niveles 95.'],
    ['Pick capital: 1 future pick(s), 1 early.', 'Capital de selecciones: 1 selección futura, 1 temprana.'],
    ['Roster not found in this league.', 'No se encontró tu plantel en esta liga.'],
  ])('%s', (en, es) => {
    expect(dynastyFactSentence(en, 'es')).toBe(es)
  })

  it('English stays English, and an unknown sentence is left as it is rather than guessed', () => {
    expect(dynastyFactSentence('Average starter age 28.4.', 'en')).toBe('Average starter age 28.4.')
    expect(dynastyFactSentence('A sentence the engine never wrote.', 'es')).toBe('A sentence the engine never wrote.')
  })
})

/**
 * NPC draft personalities — deterministic assignment, historical inference, scoring, trade policy, audit payload.
 *
 * AUDIT (existing paths — May 2026):
 * - **Config**: `DraftSession.commissionerAiManagers` JSON (`CommissionerAiManagersBlob`): assignments per orphan/NPC
 *   roster (`aiStyle`, `tradeAggression`, optional `npcDraftPersonality`, `npcFavoriteTeamAbbr`); `tradeRules`
 *   includes optional **`npcDraftTradingEnabled`** (NPC pick trades opt-in).
 * - **Orphan detection**: `getOrphanRosterIdsForLeague` / commissioner validates assignments vs orphans (`CommissionerAiDraftManagerService`).
 * - **AI autopick (timer / BPA path)**: `tryAiOpponentAutopickForExpiredTimer` (`liveDraftAiAutopick.ts`) → `decideDraftPickWithScores`
 *   → `submitPick`. Uses AI opponents league settings (`getAiOpponentsSettings`). Pool from `loadAutopickDraftContextForOnClock`.
 * - **Orphan CPU/AI drafter path**: `executeDraftPickForOrphan` (`OrphanAIManagerService`) — separate from AI opponents product flag;
 *   logs to **`AiManagerAuditLog`** via `logAction`.
 * - **liveDraftAiAutopick** also calls **`logAction`** when `isRosterAiControlled` or an NPC personality is active, with
 *   `buildNpcAiManagerDraftAuditPayload` (personality, candidates, reason).
 * - **NPC / pick trades**: `canAiProposeTrade` + `canNpcSendOrAcceptDraftTrade` — full auto-accept/execute of NPC trades is
 *   **not** implemented as an autonomous negotiation loop here; route handlers + `maybeAutoRespondToTradeProposal` remain the
 *   integration surface (**future-state** for rich NPC trade negotiation).
 */

import { describe, expect, it } from 'vitest'

import { decideDraftPickWithScores } from '@/lib/ai/opponents/draft/aiOpponentDraft'
import type { BotProfile, DraftDecisionContext, DraftPlayerOption } from '@/lib/ai/opponents/types'
import {
  assignNpcDraftPersonality,
  inferHistoricalDraftPersonality,
  mergeNpcPersonalityIntoBlob,
  buildNpcAiManagerDraftAuditPayload,
  pickRandomNpcPersonality,
} from '@/lib/live-draft-engine/npcDraftPersonality'
import { canNpcSendOrAcceptDraftTrade } from '@/lib/live-draft-engine/npcDraftTradePolicy'
import type { CommissionerAiManagersBlob } from '@/lib/commissioner-ai-draft-manager/types'
import { parseCommissionerAiManagers } from '@/lib/commissioner-ai-draft-manager/CommissionerAiDraftManagerService'

function baseBot(over?: Partial<BotProfile>): BotProfile {
  const tendencies: BotProfile['tendencies'] = {
    winNowVsFuture: 0,
    riskTolerance: 0.5,
    tradeAggression: 0.5,
    waiverAggression: 0.5,
    rookieAppetite: 40,
    positionalPremiumBias: {},
    zeroRbWeight: 18,
    heroRbWeight: 22,
    qbEarlyWeight: 12,
    tePremiumWeight: 12,
    chaosReach: 12,
    devyWeight: 10,
    pickHoarding: 0.5,
    vetBuyerWeight: 0.5,
    floorVsUpside: 50,
    bluffTendency: 0,
  }
  return {
    botId: 't-bot',
    displayName: 'T',
    avatarUrl: null,
    archetypeId: 'balanced_builder',
    description: '',
    tendencies,
    activityLevel: 1,
    ...over,
  }
}

function baseCtx(
  partial: Partial<DraftDecisionContext> & {
    available: DraftPlayerOption[]
    rosterCounts?: Record<string, number>
  }
): DraftDecisionContext {
  const bot = partial.bot ?? baseBot()
  return {
    leagueId: 'l1',
    teamId: 'tm1',
    bot,
    format: 'snake',
    scoring: null,
    isSuperflex: false,
    isTePremium: false,
    isDynasty: false,
    isDevy: false,
    round: partial.round ?? 4,
    pickInRound: partial.pickInRound ?? 5,
    overallPick: partial.overallPick ?? 40,
    rosterCounts: partial.rosterCounts ?? { RB: 0, WR: 2, TE: 0, QB: 1, FL: 0 },
    queue: partial.queue ?? [],
    available: partial.available,
    avoidPlayerIds: partial.avoidPlayerIds ?? [],
    npcDraftPersonality: partial.npcDraftPersonality,
    npcFavoriteTeamAbbr: partial.npcFavoriteTeamAbbr,
    leagueSport: partial.leagueSport ?? 'NFL',
    rosteredSkillTeams: partial.rosteredSkillTeams,
  }
}

describe('assignNpcDraftPersonality', () => {
  it('preserves existing personality', () => {
    const r = assignNpcDraftPersonality({
      existingPersonality: 'CONTRARIAN_CHAOS',
      historicalPicks: [{ position: 'RB', team: 'DAL', overallPick: 3 }],
      treatAsFreshLeague: false,
      randomSeed: 99,
    })
    expect(r.personality).toBe('CONTRARIAN_CHAOS')
    expect(r.source).toBe('existing')
  })

  it('startup/redraft with no history uses deterministic random personality', () => {
    const r = assignNpcDraftPersonality({
      existingPersonality: null,
      historicalPicks: [],
      treatAsFreshLeague: true,
      randomSeed: 1001,
    })
    expect(r.source).toBe('random')
    expect(r.personality).toBe(pickRandomNpcPersonality(1001))
  })

  it('historical mimic: youth/dynasty bias', () => {
    const picks = Array.from({ length: 12 }).map((_, i) => ({
      position: i % 2 === 0 ? 'RB' : 'WR',
      team: 'SEA',
      overallPick: i + 1,
      isRookie: true,
    }))
    expect(inferHistoricalDraftPersonality(picks)).toBe('YOUTH_DYNASTY_UPSIDE')
  })

  it('historical mimic: win-now veterans', () => {
    const picks = [
      { position: 'QB', team: 'KC', overallPick: 1, age: 30 },
      { position: 'RB', team: 'SF', overallPick: 24, age: 31 },
      { position: 'WR', team: 'DAL', overallPick: 36, age: 32 },
    ]
    expect(inferHistoricalDraftPersonality(picks)).toBe('WIN_NOW_VETERAN')
  })

  it('historical mimic: best player available (ADP tracking)', () => {
    const picks = [
      { position: 'RB', team: 'TB', overallPick: 6, expectedAdpRank: 6 },
      { position: 'WR', team: 'PHI', overallPick: 19, expectedAdpRank: 18 },
      { position: 'TE', team: 'KC', overallPick: 30, expectedAdpRank: 31 },
      { position: 'QB', team: 'BUF', overallPick: 43, expectedAdpRank: 42 },
    ]
    expect(inferHistoricalDraftPersonality(picks)).toBe('BEST_PLAYER_AVAILABLE')
  })

  it('historical mimic: contrarian reaches', () => {
    const picks = [
      { position: 'RB', team: 'ATL', overallPick: 45, expectedAdpRank: 8 },
      { position: 'WR', team: 'CAR', overallPick: 60, expectedAdpRank: 12 },
    ]
    expect(inferHistoricalDraftPersonality(picks)).toBe('CONTRARIAN_CHAOS')
  })
})

describe('decideDraftPickWithScores — personality scoring', () => {
  const pid = (name: string, pos: string, team: string, adp: number, extras?: Partial<DraftPlayerOption>): DraftPlayerOption => ({
    playerId: `id:${name}`,
    name,
    position: pos,
    team,
    adp,
    tier: null,
    sport: 'NFL',
    ...extras,
  })

  it('NEED_BASED boosts RB when roster needs RB', () => {
    const available = [
      pid('Wr1', 'WR', 'DAL', 45),
      pid('Rb1', 'RB', 'NYG', 46),
    ]
    const need = decideDraftPickWithScores(
      baseCtx({
        available,
        rosterCounts: { RB: 0, WR: 3, TE: 1, QB: 1, FL: 0 },
        round: 6,
        npcDraftPersonality: 'NEED_BASED',
      })
    )
    expect(need.decision.playerId).toBe('id:Rb1')
  })

  it('BEST_PLAYER_AVAILABLE prefers stronger ADP value', () => {
    const available = [
      pid('Late', 'WR', 'NYJ', 120),
      pid('Star', 'WR', 'MIA', 12),
    ]
    const bpa = decideDraftPickWithScores(
      baseCtx({
        available,
        npcDraftPersonality: 'BEST_PLAYER_AVAILABLE',
        round: 2,
      })
    )
    expect(bpa.decision.playerId).toBe('id:Star')
  })

  it('YOUTH_DYNASTY_UPSIDE boosts rookie', () => {
    const available = [
      pid('Vet Wr', 'WR', 'GB', 40, { age: 29, isRookie: false }),
      pid('Rookie Rb', 'RB', 'CHI', 42, { age: 22, isRookie: true }),
    ]
    const y = decideDraftPickWithScores(
      baseCtx({
        available,
        npcDraftPersonality: 'YOUTH_DYNASTY_UPSIDE',
        round: 5,
      })
    )
    expect(y.decision.playerId).toBe('id:Rookie Rb')
  })

  it('HOMER_TEAM_FAVORITE boosts favorite team', () => {
    const available = [
      pid('Other', 'WR', 'CAR', 62),
      pid('Homer', 'WR', 'DAL', 64),
    ]
    const b = baseBot()
    const h = decideDraftPickWithScores(
      baseCtx({
        available,
        bot: { ...b, tendencies: { ...b.tendencies, chaosReach: 0 } },
        rosterCounts: { RB: 1, WR: 2, TE: 1, QB: 1, FL: 0 },
        npcDraftPersonality: 'HOMER_TEAM_FAVORITE',
        npcFavoriteTeamAbbr: 'DAL',
        round: 5,
      })
    )
    expect(h.decision.playerId).toBe('id:Homer')
  })

  it('never selects wrong sport when leagueSport is set', () => {
    const available: DraftPlayerOption[] = [
      { playerId: 'nba', name: 'Star', position: 'PG', team: 'BOS', adp: 5, tier: null, sport: 'NBA' },
      { playerId: 'nfl', name: 'Star', position: 'WR', team: 'MIN', adp: 40, tier: null, sport: 'NFL' },
    ]
    const r = decideDraftPickWithScores(
      baseCtx({
        available,
        leagueSport: 'NFL',
        npcDraftPersonality: 'BEST_PLAYER_AVAILABLE',
      })
    )
    expect(r.decision.playerId).toBe('nfl')
  })

  it('skips unavailable top score by using only eligible pool (sport filter)', () => {
    const available: DraftPlayerOption[] = [
      { playerId: 'bad', name: 'X', position: 'WR', team: 'DAL', adp: 2, tier: null, sport: 'NBA' },
      { playerId: 'good', name: 'Y', position: 'WR', team: 'DAL', adp: 40, tier: null, sport: 'NFL' },
    ]
    const r = decideDraftPickWithScores(baseCtx({ available, leagueSport: 'NFL' }))
    expect(r.decision.playerId).toBe('good')
  })
})

describe('mergeNpcPersonalityIntoBlob', () => {
  it('writes npcDraftPersonality onto assignment', () => {
    const blob: CommissionerAiManagersBlob = {
      assignments: [
        {
          rosterId: 'r1',
          aiStyle: 'BPA',
          tradeAggression: 'low',
          active: true,
        },
      ],
      tradeRules: {
        allowOutbound: true,
        allowInbound: true,
        blockAiToAi: true,
        proposalCooldownSeconds: 90,
        maxProposalsPerRound: 4,
        acceptConfidenceMin: 0.58,
      },
    }
    const next = mergeNpcPersonalityIntoBlob(blob, 'r1', {
      npcDraftPersonality: 'NEED_BASED',
      npcFavoriteTeamAbbr: 'PHI',
    })
    expect(next.assignments[0]?.npcDraftPersonality).toBe('NEED_BASED')
    expect(next.assignments[0]?.npcFavoriteTeamAbbr).toBe('PHI')
    const parsed = parseCommissionerAiManagers(next)
    expect(parsed.assignments[0]?.npcDraftPersonality).toBe('NEED_BASED')
  })
})

describe('canNpcSendOrAcceptDraftTrade', () => {
  it('blocked by default', () => {
    expect(canNpcSendOrAcceptDraftTrade({})).toBe(false)
    expect(canNpcSendOrAcceptDraftTrade({ npcDraftTradingEnabled: false })).toBe(false)
  })

  it('allowed only when commissioner explicitly enables', () => {
    expect(canNpcSendOrAcceptDraftTrade({ npcDraftTradingEnabled: true })).toBe(true)
  })
})

describe('buildNpcAiManagerDraftAuditPayload', () => {
  it('includes personality, chosen player, candidate scores', () => {
    const payload = buildNpcAiManagerDraftAuditPayload({
      personality: 'BALANCED',
      chosenPlayerId: 'p1',
      chosenPlayerName: 'A',
      position: 'RB',
      reason: 'test',
      candidateScores: [
        { playerId: 'p1', score: 100 },
        { playerId: 'p2', score: 90 },
      ],
      leagueSport: 'NFL',
    })
    expect(payload.kind).toBe('npc_draft_autopick')
    expect(payload.npcDraftPersonality).toBe('BALANCED')
    expect(payload.chosenPlayerId).toBe('p1')
    expect((payload.candidateScores as unknown[]).length).toBe(2)
  })
})

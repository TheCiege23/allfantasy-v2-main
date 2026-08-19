import { describe, expect, it } from 'vitest'

import type { CanonicalLeagueRules } from '@/lib/league-runtime/canonicalLeagueRules'
import { normalizeLeagueRuntimeEventType } from '@/lib/league-runtime/leagueRuntimeEvents'
import {
  applyNflRedraftFreeAgentAdd,
  buildNflRedraftWaiverRuntimeState,
  buildWaiverRuntimeEvent,
  processNflRedraftWaiverClaims,
  validateNflRedraftWaiverClaim,
  validateNflRedraftFreeAgentAdd,
  type NflRedraftWaiverClaimInput,
  type NflRedraftWaiverRosterInput,
} from '@/lib/waiver-runtime/canonicalNflRedraftWaiverRuntime'

const baseRules: CanonicalLeagueRules = {
  version: 1,
  leagueId: 'league-g38',
  generatedAtIso: '2026-07-02T12:00:00.000Z',
  source: {
    commissionerSettings: 'League',
    draftSettings: 'LeagueSettings',
    effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
    settingsSnapshotVersion: 6,
    presetKey: 'af:v2|concept=redraft|sport=NFL',
  },
  general: {
    name: 'G38 NFL Redraft',
    sport: 'NFL',
    season: 2026,
    format: 'redraft',
    variant: null,
    teamCount: 3,
    rosterSize: 3,
    lifecycleState: 'active',
    status: 'active',
    locked: false,
    emergencyPaused: false,
    timezone: 'America/New_York',
    language: 'en',
  },
  draft: {} as CanonicalLeagueRules['draft'],
  scoring: {} as CanonicalLeagueRules['scoring'],
  roster: {
    size: 3,
    starters: ['QB', 'RB'],
    irSlots: 0,
    eligibleReserveStatuses: [],
    allowPreDraftMoves: true,
    preventBenchDrops: false,
    lockAllMoves: false,
  },
  waivers: {
    type: 'faab',
    continuous: false,
    processingDays: [3],
    processingTimeUtc: '10:00',
    processingTimeLocal: '06:00',
    claimLimitPerPeriod: null,
    maxClaimsPerPeriod: null,
    priorityBehavior: 'rolling',
    gameLockBehavior: 'per_player',
    dropLockBehavior: 'locked_after_kickoff',
    freeAgentUnlockBehavior: 'after_clear',
    sameDayAddDropRules: null,
    faabEnabled: true,
    faabBudget: 100,
    faabMinBid: 1,
    faabResetRules: null,
    tiebreakRule: 'waiver_priority',
    instantFreeAgencyAfterClear: true,
  },
  trades: {} as CanonicalLeagueRules['trades'],
  playoffs: {} as CanonicalLeagueRules['playoffs'],
  schedule: {} as CanonicalLeagueRules['schedule'],
  permissions: {
    settingsEditableByRoles: ['commissioner', 'co_commissioner'],
    memberMovesLocked: false,
    inviteLinksDisabled: false,
    inviteCapacityOverride: false,
  },
  intelligence: {} as CanonicalLeagueRules['intelligence'],
}

const rosters: NflRedraftWaiverRosterInput[] = [
  {
    rosterId: 'alpha',
    displayName: 'Alpha',
    ownerId: 'user-alpha',
    faabBalance: 100,
    waiverPriority: 2,
    players: [
      { playerId: 'alpha-qb', playerName: 'Alpha QB', position: 'QB', sport: 'NFL', slotType: 'QB' },
      { playerId: 'alpha-rb', playerName: 'Alpha RB', position: 'RB', sport: 'NFL', slotType: 'RB' },
      { playerId: 'alpha-bn', playerName: 'Alpha Bench', position: 'WR', sport: 'NFL', slotType: 'BENCH' },
    ],
  },
  {
    rosterId: 'beta',
    displayName: 'Beta',
    ownerId: 'user-beta',
    faabBalance: 50,
    waiverPriority: 1,
    players: [
      { playerId: 'beta-qb', playerName: 'Beta QB', position: 'QB', sport: 'NFL', slotType: 'QB' },
      { playerId: 'beta-rb', playerName: 'Beta RB', position: 'RB', sport: 'NFL', slotType: 'RB' },
    ],
  },
]

const freeAgents = [
  { playerId: 'target-a', playerName: 'Target A', position: 'WR', team: 'BUF', sport: 'NFL', slotType: 'BENCH' },
  { playerId: 'target-b', playerName: 'Target B', position: 'RB', team: 'NYJ', sport: 'NFL', slotType: 'BENCH' },
  { playerId: 'target-c', playerName: 'Target C', position: 'TE', team: 'LV', sport: 'NFL', slotType: 'BENCH' },
]

function claim(overrides: Partial<NflRedraftWaiverClaimInput>): NflRedraftWaiverClaimInput {
  return {
    claimId: overrides.claimId ?? `claim-${overrides.rosterId}-${overrides.addPlayerId}`,
    rosterId: overrides.rosterId ?? 'alpha',
    addPlayerId: overrides.addPlayerId ?? 'target-a',
    addPlayerName: overrides.addPlayerName ?? 'Target A',
    addPlayerPosition: overrides.addPlayerPosition ?? 'WR',
    addPlayerTeam: overrides.addPlayerTeam ?? 'BUF',
    dropPlayerId: overrides.dropPlayerId ?? null,
    dropPlayerName: overrides.dropPlayerName ?? null,
    bidAmount: overrides.bidAmount ?? 1,
    priority: overrides.priority ?? 1,
    conditionalGroupId: overrides.conditionalGroupId ?? null,
    conditionalRank: overrides.conditionalRank ?? 1,
    status: overrides.status ?? 'pending',
    submittedAtIso: overrides.submittedAtIso ?? '2026-07-02T12:00:00.000Z',
    actorUserId: overrides.actorUserId ?? null,
  }
}

function state(args: {
  rules?: CanonicalLeagueRules
  claims?: NflRedraftWaiverClaimInput[]
  rosterRows?: NflRedraftWaiverRosterInput[]
  includeFreeAgents?: boolean
}) {
  return buildNflRedraftWaiverRuntimeState({
    leagueId: 'league-g38',
    seasonId: 'season-g38',
    season: 2026,
    week: 5,
    rules: args.rules ?? baseRules,
    rosters: args.rosterRows ?? rosters,
    claims: args.claims ?? [],
    freeAgents: args.includeFreeAgents === false ? [] : freeAgents,
    transactions: [],
    now: new Date('2026-07-02T12:00:00.000Z'),
  })
}

describe('G38 canonical NFL redraft waiver runtime', () => {
  it('validates roster capacity, duplicate claims, locked drops, and FAAB bids', () => {
    const s = state({ claims: [claim({ claimId: 'existing', addPlayerId: 'target-a' })] })

    expect(
      validateNflRedraftWaiverClaim({
        state: s,
        claim: claim({ claimId: 'dup', addPlayerId: 'target-a', dropPlayerId: 'alpha-bn' }),
      }),
    ).toMatchObject({ ok: false, code: 'DUPLICATE_PENDING_CLAIM' })

    expect(
      validateNflRedraftWaiverClaim({
        state: state({ claims: [] }),
        claim: claim({ claimId: 'full', addPlayerId: 'target-b', dropPlayerId: null }),
      }),
    ).toMatchObject({ ok: false, code: 'ROSTER_FULL' })

    const locked = state({
      rosterRows: [
        {
          ...rosters[0],
          players: rosters[0].players.map((player) =>
            player.playerId === 'alpha-bn' ? { ...player, isLocked: true } : player,
          ),
        },
      ],
    })
    expect(
      validateNflRedraftWaiverClaim({
        state: locked,
        claim: claim({ claimId: 'locked', addPlayerId: 'target-b', dropPlayerId: 'alpha-bn' }),
      }),
    ).toMatchObject({ ok: false, code: 'LOCKED_PLAYER' })

    expect(
      validateNflRedraftWaiverClaim({
        state: state({ claims: [] }),
        claim: claim({ claimId: 'too-rich', rosterId: 'beta', addPlayerId: 'target-b', bidAmount: 99 }),
      }),
    ).toMatchObject({ ok: false, code: 'INSUFFICIENT_FAAB' })
  })

  it('processes FAAB claims by bid, then waiver priority, and records deterministic transactions/events', () => {
    const s = state({
      claims: [
        claim({ claimId: 'alpha-low', rosterId: 'alpha', addPlayerId: 'target-a', bidAmount: 12, dropPlayerId: 'alpha-bn' }),
        claim({ claimId: 'beta-high', rosterId: 'beta', addPlayerId: 'target-a', bidAmount: 18 }),
        claim({ claimId: 'alpha-tie', rosterId: 'alpha', addPlayerId: 'target-b', bidAmount: 10, dropPlayerId: 'alpha-bn' }),
        claim({ claimId: 'beta-tie', rosterId: 'beta', addPlayerId: 'target-b', bidAmount: 10, dropPlayerId: 'beta-rb' }),
      ],
    })
    const processed = processNflRedraftWaiverClaims({ state: s, actorUserId: 'commissioner' })

    expect(processed.results.map((result) => [result.claimId, result.resultType, result.success])).toEqual([
      ['beta-high', 'won', true],
      ['alpha-low', 'failed', false],
      ['beta-tie', 'won', true],
      ['alpha-tie', 'failed', false],
    ])
    const beta = processed.teams.find((team) => team.rosterId === 'beta')!
    expect(beta.faabBalance).toBe(22)
    expect(beta.players.map((player) => player.playerId)).toEqual(
      expect.arrayContaining(['target-a', 'target-b']),
    )
    expect(processed.results.filter((result) => result.transaction.type === 'waiver_claim_approved')).toHaveLength(2)
    expect(processed.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'waiver.processing.started',
        'waiver.claim.won',
        'waiver.claim.failed',
        'waiver.faab.deducted',
        'waiver.transaction.recorded',
        'waiver.processed',
      ]),
    )
  })

  it('updates rolling waiver priority for non-FAAB waiver modes', () => {
    const rollingRules: CanonicalLeagueRules = {
      ...baseRules,
      waivers: { ...baseRules.waivers, type: 'rolling', faabEnabled: false, faabMinBid: 0 },
    }
    const processed = processNflRedraftWaiverClaims({
      state: state({
        rules: rollingRules,
        claims: [claim({ claimId: 'beta-rolling', rosterId: 'beta', addPlayerId: 'target-c', bidAmount: 0 })],
      }),
    })

    const result = processed.results[0]
    expect(result.success).toBe(true)
    expect(result.priorityBefore).toBe(1)
    expect(result.priorityAfter).toBe(3)
    expect(processed.events.map((event) => event.type)).toContain('waiver.priority.updated')
  })

  it('supports conditional backup claims after a higher-ranked claim fails', () => {
    const processed = processNflRedraftWaiverClaims({
      state: state({
        claims: [
          claim({ claimId: 'beta-wins-a', rosterId: 'beta', addPlayerId: 'target-a', bidAmount: 20 }),
          claim({
            claimId: 'alpha-a',
            rosterId: 'alpha',
            addPlayerId: 'target-a',
            bidAmount: 5,
            dropPlayerId: 'alpha-bn',
            conditionalGroupId: 'alpha-backups',
            conditionalRank: 1,
          }),
          claim({
            claimId: 'alpha-b',
            rosterId: 'alpha',
            addPlayerId: 'target-b',
            bidAmount: 5,
            dropPlayerId: 'alpha-bn',
            conditionalGroupId: 'alpha-backups',
            conditionalRank: 2,
          }),
        ],
      }),
    })

    expect(processed.results.map((result) => [result.claimId, result.resultType, result.success])).toEqual([
      ['beta-wins-a', 'won', true],
      ['alpha-a', 'failed', false],
      ['alpha-b', 'won', true],
    ])
    expect(processed.teams.find((team) => team.rosterId === 'alpha')?.players.map((player) => player.playerId)).toContain('target-b')
  })

  it('skips lower conditional claims once the group has already succeeded', () => {
    const processed = processNflRedraftWaiverClaims({
      state: state({
        claims: [
          claim({
            claimId: 'alpha-a',
            rosterId: 'alpha',
            addPlayerId: 'target-a',
            bidAmount: 12,
            dropPlayerId: 'alpha-bn',
            conditionalGroupId: 'alpha-group',
            conditionalRank: 1,
          }),
          claim({
            claimId: 'alpha-b',
            rosterId: 'alpha',
            addPlayerId: 'target-b',
            bidAmount: 12,
            dropPlayerId: 'alpha-bn',
            conditionalGroupId: 'alpha-group',
            conditionalRank: 2,
          }),
        ],
      }),
    })

    expect(processed.results[0]).toMatchObject({ claimId: 'alpha-a', success: true })
    expect(processed.results[1]).toMatchObject({
      claimId: 'alpha-b',
      success: false,
      resultType: 'conditional_group_satisfied',
    })
  })

  it('applies free agent add/drop immediately when free agency is open', () => {
    const s = state({ claims: [] })
    expect(
      validateNflRedraftFreeAgentAdd({
        state: s,
        add: {
          rosterId: 'alpha',
          addPlayerId: 'target-c',
          addPlayerName: 'Target C',
          addPlayerPosition: 'TE',
          dropPlayerId: 'alpha-bn',
        },
      }),
    ).toMatchObject({ ok: true })

    const applied = applyNflRedraftFreeAgentAdd({
      state: s,
      add: {
        rosterId: 'alpha',
        addPlayerId: 'target-c',
        addPlayerName: 'Target C',
        addPlayerPosition: 'TE',
        dropPlayerId: 'alpha-bn',
        actorUserId: 'user-alpha',
      },
      now: new Date('2026-07-02T12:05:00.000Z'),
    })
    expect(applied.ok).toBe(true)
    if (applied.ok) {
      expect(applied.result.transaction.type).toBe('free_agent_added')
      expect(applied.teams.find((team) => team.rosterId === 'alpha')?.players.map((player) => player.playerId)).toContain('target-c')
      expect(applied.events.map((event) => event.type)).toEqual(
        expect.arrayContaining(['waiver.free_agent.added', 'roster.player.added', 'roster.player.dropped']),
      )
    }
  })

  it('normalizes the new waiver event aliases for downstream integration', () => {
    expect(normalizeLeagueRuntimeEventType('waiver_claim_won')).toBe('waiver.claim.won')
    expect(normalizeLeagueRuntimeEventType('free_agent_added')).toBe('waiver.free_agent.added')
    expect(normalizeLeagueRuntimeEventType('commissioner_waiver_override')).toBe('commissioner.waiver_override')
    expect(
      buildWaiverRuntimeEvent({
        leagueId: 'league-g38',
        type: 'waiver_claim_edited',
        actorUserId: 'user-alpha',
        payload: { claimId: 'claim-1' },
      }),
    ).toMatchObject({ type: 'waiver.claim.edited', actorUserId: 'user-alpha' })
  })
})

// Shared fakes for Decision OS lineup tests (not a test file — no DB required).
import type { LineupActionItem, LineupActionSummaryPayload } from '@/lib/lineup-actions/types'
import type { RedraftLineupPlayer, RedraftLineupValidationResult } from '@/lib/redraft/lineupValidation'
import type { ResolvedRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import type { LineupWorldDeps } from '@/lib/decision-os/lineup/world'

export function fakeRosterConfig(): ResolvedRosterConfig {
  return {
    starterCapacities: new Map([['QB', 1], ['RB', 2], ['WR', 2], ['TE', 1], ['FLX', 1]]),
    benchSlots: 5,
    irSlots: 1,
    taxiSlots: 0,
    maxRosterSize: 15,
    source: 'defaults',
  }
}

export function fakePlayers(): RedraftLineupPlayer[] {
  return [
    { playerId: 'p1', playerName: 'QB One', position: 'QB', sport: 'NFL', slotType: 'QB' },
    { playerId: 'p2', playerName: 'RB One', position: 'RB', sport: 'NFL', slotType: 'RB' },
  ] as RedraftLineupPlayer[]
}

export function fakeWorldDeps(locked = false): LineupWorldDeps {
  return {
    resolveRosterConfig: () => fakeRosterConfig(),
    evaluateLock: () => ({ locked, policy: 'football_weekly', reason: locked ? 'Locked (TNF kickoff).' : undefined }),
    now: () => new Date('2026-09-10T12:00:00Z'),
  }
}

export function fakeValidate(result?: Partial<RedraftLineupValidationResult>): (a: unknown) => RedraftLineupValidationResult {
  const base: RedraftLineupValidationResult = { ok: true, issues: [], errorCount: 0, warningCount: 0, ...result }
  return () => base
}

export function action(leagueId: string, over: Partial<LineupActionItem> = {}): LineupActionItem {
  return {
    leagueId,
    leagueName: 'Test League',
    sport: 'NFL' as LineupActionItem['sport'],
    platform: 'native',
    teamId: 't1',
    slotIndex: 0,
    slotId: 'QB',
    slotLabel: 'QB',
    playerId: 'p1',
    playerName: 'QB One',
    reasonType: 'empty_starter',
    urgency: 'urgent',
    lockTime: null,
    recommendedAction: 'Set a starter for QB.',
    suggestedReplacementPlayerId: null,
    confidence: 0.8,
    expectedGain: 5,
    sourceModule: 'lineup_scan',
    message: 'QB slot is empty.',
    severity: 'critical',
    ...over,
  }
}

export function payload(leagueId: string, actions: LineupActionItem[] = [], scanIncomplete = false): LineupActionSummaryPayload {
  return {
    totalIssues: actions.length,
    totalUnresolvedSlotActions: actions.length,
    scanWarningLeagues: 0,
    leaguesNeedingAttention: actions.length ? 1 : 0,
    lineupsNeedingAttention: actions.length ? 1 : 0,
    urgentLineupActions: actions.filter((a) => a.urgency === 'urgent').length,
    lockedMissedActions: 0,
    displayMode: 'unresolved_slots',
    displayCount: actions.length,
    displayLabelKey: 'k',
    displayLabelParams: {},
    displaySubtextKey: null,
    displaySubtextParams: null,
    urgentSubtextKey: null,
    urgentSubtextParams: null,
    actions,
    leagues: [
      { leagueId, leagueName: 'Test League', leagueAvatar: null, sport: 'NFL', platform: 'native', issues: [], chimmyAdvice: '', actions, scanIncomplete },
    ],
    scannedLeagues: 1,
    scannedSleeperLeagues: 0,
    scannedNativeLeagues: 1,
    lastUpdatedAt: new Date().toISOString(),
  }
}

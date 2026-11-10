/**
 * Commissioner-dashboard fixtures for the tournament harness, typed against the dashboard's own payload types so a
 * fixture that drifts from the real shape fails the typecheck. Same tournament as fixtures.ts (AllFantasy Open
 * 2026, week 6 of the Opening Round); the viewer is its creator. Dumped to JSON for the capture script. Harness-only.
 */
import type { TournamentCommissionerSummary, AnnouncementFeedItem } from '@/components/tournament/TournamentCommissionerDashboard'
import type { ControlData } from '@/components/tournament/TournamentControlDashboard'
import type { RequestRow } from '@/components/tournament/TournamentApprovalsCenter'
import type { DraftScheduleV1 } from '@/lib/tournament/draft-schedule-types'
import { defaultAiAutomationV1 } from '@/lib/tournament/ai-automation-hub'
import { TOURNAMENT_ID } from './fixtures'

const FEEDERS = [
  ['Gridiron North', 'Gridiron Conference', 'GRDN7Q'],
  ['Gridiron South of the Mississippi', 'Gridiron Conference', 'GRDS4K'],
  ['Blitz East', 'Blitz Conference', 'BLZE2M'],
  ['Blitz West', 'Blitz Conference', 'BLZW9X'],
] as const

const draftScheduleV1: DraftScheduleV1 = {
  phases: {
    startup: { mode: 'uniform', uniform: { scheduledAt: '2026-08-30T00:00:00.000Z', timezone: 'America/New_York', pickTimerSec: 90, draftMode: 'snake', status: 'complete' } },
    redraft_first: { mode: 'uniform', uniform: { scheduledAt: '2026-10-28T00:00:00.000Z', timezone: 'America/New_York', pickTimerSec: 90, draftMode: 'snake', status: 'scheduled' } },
  },
}

export const summary: TournamentCommissionerSummary = {
  tournament: { id: TOURNAMENT_ID, name: 'AllFantasy Open 2026', sport: 'NFL', season: 2026, status: 'in_progress', lockedAt: '2026-08-28T00:00:00.000Z' },
  settingsSnapshot: {
    participantPoolSize: 32, qualificationWeeks: 8, draftType: 'snake', roundRedraftSchedule: [9, 14],
    finalsRedraftEnabled: true, bubbleWeekEnabled: true, faabBudgetDefault: 1000,
  },
  counts: {
    subLeagues: 4, expectedSubLeagues: 4, totalFilledTeams: 31, totalEmptySlots: 1, totalCapacity: 32,
    participants: 31, waitlisted: 3, activeParticipants: 31, eliminated: 0,
  },
  rounds: [
    { roundIndex: 1, phase: 'qualification', name: 'Opening Round', startWeek: 1, endWeek: 8, status: 'active' },
    { roundIndex: 2, phase: 'elimination', name: 'Elite Eight', startWeek: 9, endWeek: 13, status: 'upcoming' },
    { roundIndex: 3, phase: 'finals', name: null, startWeek: 14, endWeek: 17, status: 'upcoming' },
  ],
  scheduleHints: { qualificationWeeks: 8, redraftWeeks: [9, 14] },
  hub: {
    visibility: 'public', waitlistEnabled: true, maxWaitlist: 20, eligibilityMode: 'open',
    draftScheduleV1, aiAutomationV1: defaultAiAutomationV1(),
  },
  monetization: { afPlan: 'af_commissioner', afTokensRemaining: 42, subscriptionPlans: ['af_commissioner'], subscriptionStatus: 'active' },
  feederLeagues: FEEDERS.map(([name, conferenceName, inviteCode], i) => ({
    tournamentLeagueId: `tl-${i + 1}`, leagueId: `lg-${i + 1}`, name, conferenceName,
    filledSlots: i === 1 ? 7 : 8, capacity: 8,
    shell: { homepage: true, leagueChat: true, draftBoard: true, rosterShell: i !== 3 },
    inviteCode, joinUrl: `https://allfantasy.ai/join/${inviteCode}`,
  })),
}

/** GET /api/tournament/[id]/access as the creator. */
export const access = { authenticated: true, isCreator: true, canUseControlConsole: true, canEditHubSettings: true }

export const announcements: AnnouncementFeedItem[] = [
  { id: 'ca-1', title: 'Week 6 is final', body: 'Two weeks left in the Opening Round. The top 2 in each league advance; 2 wildcards come from the bubble.', type: 'round_update', pinned: true, createdAt: '2026-10-14T13:00:00.000Z' },
  { id: 'ca-2', title: null, body: 'Reminder: lineups lock at each game’s kickoff, not at the first game of the week.', type: 'general', pinned: false, createdAt: '2026-10-09T16:30:00.000Z' },
]

export const waitlist = {
  entries: ['Morgan Alexander-Fitzgerald', 'Jules', 'Kai'].map((displayName, i) => ({
    order: i + 1, userId: `cku0000waitlist${i}`, displayName, createdAt: `2026-08-2${i + 1}T12:00:00.000Z`,
  })),
}

export const staff = {
  staff: [
    { userId: 'cku0000staff00001', displayName: 'Riley Castellanos-Whitmore', permissions: { dashboard: true, manageLeagues: true, manageDrafts: true } },
    { userId: 'cku0000staff00002', displayName: 'Avery', permissions: { dashboard: true, manageChat: true } },
  ],
}

export const control: ControlData = {
  tournamentId: TOURNAMENT_ID,
  tournamentName: 'AllFantasy Open 2026',
  leagues: FEEDERS.map(([leagueName, conferenceName, inviteCode], i) => ({
    tournamentLeagueId: `tl-${i + 1}`, leagueId: `lg-${i + 1}`, leagueName, conferenceName, roundIndex: 1, phase: 'qualification',
    inviteCode, joinUrl: `https://allfantasy.ai/join/${inviteCode}`, leagueSize: 8, rosterCount: i === 1 ? 7 : 8,
    fillStatus: i === 1 ? 'partial' : 'full',
  })),
}

export const approvals: { requests: RequestRow[] } = {
  requests: [
    {
      id: 'req-1', leagueId: 'lg-3', leagueName: 'Blitz East', status: 'pending', createdAt: '2026-10-12T20:15:00.000Z',
      proposedPatch: { waiverType: 'rolling', tradeDeadlineWeek: 7 },
      requester: { id: 'cku0000req000001', username: 'quinn', displayName: 'Quinn' },
    },
  ],
}

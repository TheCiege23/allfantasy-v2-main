/**
 * Zombie league fixtures for the DB-free harness, typed against each screen's own response type with
 * `satisfies`, so a fixture that drifts from the real shape fails the typecheck instead of rendering a
 * screen the app never could.  They are dumped to JSON for the capture
 * script. Harness-only.
 *
 * `/api/zombie/league` feeds three readers — the shell (ZMeta), the home page (Pack) and Standings
 * (`league.teams` as Row[]) — so the one payload satisfies all three.
 */
import type { ZMeta } from '@/app/zombie/[leagueId]/ZombieLeagueShell'
import type { FeedAnimation, Pack, TeamRow } from '@/app/zombie/[leagueId]/ZombieLeagueHomeClient'
import type { Row } from '@/app/zombie/[leagueId]/standings/page'
import type { MatchupsPayload } from '@/app/zombie/[leagueId]/matchups/page'
import type { InvPayload } from '@/app/zombie/[leagueId]/items/page'

type Team = TeamRow & Row

const team = (rosterId: string, name: string, manager: string, status: string, wins: number, losses: number, pointsFor: number, extra: Partial<Team> = {}): Team => ({
  rosterId, status, wins, losses, pointsFor, pointsAgainst: Math.round(pointsFor * 0.93 * 10) / 10,
  fantasyTeamName: name, displayName: manager, weeklyScore: null, weeklyWinnings: null, totalWinnings: 0, serumsHeld: 0, weaponsHeld: 0,
  ...extra,
})

const TEAMS: Team[] = [
  team('r1', 'Last Light Brigade', 'Ciege', 'Survivor', 7, 2, 1288.4, { weeklyScore: 141.2, totalWinnings: 46.5, serumsHeld: 1, weaponsHeld: 2, riskScore: 18 }),
  team('r2', 'Bunker Boys', 'Morgan', 'Survivor', 6, 3, 1240.1, { weeklyScore: 128.7, totalWinnings: 31, weaponsHeld: 1, riskScore: 34 }),
  team('r3', 'The Barricade Collective of Greater Columbus', 'Riley Castellanos-Whitmore', 'Survivor', 5, 4, 1199.6, { weeklyScore: 101.4, totalWinnings: 22.5, riskScore: 71 }),
  team('r4', 'Night Shift', 'Jordan', 'Revived', 5, 4, 1176.2, { weeklyScore: 97.9, totalWinnings: 18, revivedAt: '2026-10-28T16:00:00.000Z', riskScore: 52 }),
  team('r5', 'Quiet Ones', 'Avery', 'Whisperer', 6, 3, 1230.8, { weeklyScore: 119.3, totalWinnings: 40 }),
  team('r6', 'Rotting Rookies', 'Lee', 'Zombie', 3, 6, 1102.3, { weeklyScore: 88.1, totalWinnings: 12, weekBecameZombie: 4, killedByRosterId: 'r1' }),
  team('r7', 'Brains Trust', 'Sam', 'Zombie', 4, 5, 1144.0, { weeklyScore: 112.6, totalWinnings: 15.5, weekBecameZombie: 6, killedByRosterId: null }),
  team('r8', 'Shamblers FC', 'Taylor', 'Zombie', 2, 7, 1021.5, { weeklyScore: 76.4, totalWinnings: 6, weekBecameZombie: 2, killedByRosterId: 'r5' }),
]

const PACK = {
  league: {
    name: 'Outbreak League',
    sport: 'NFL',
    logoUrl: null,
    currentWeek: 10,
    isPaid: true,
    experienceMode: 'enhanced',
    potTotal: 400,
    whispererIsPublic: false,
    universeId: null,
    status: 'in_season',
    level: { name: 'Gamma', rankOrder: 2, tierLabel: 'Tier 2', tierTheme: null },
    counts: { survivor: 4, zombie: 3, whisperer: 1, revived: 1, alive: 4, total: 8, horde: 3 },
    teams: TEAMS,
    whispererRecord: null,
    announcements: [
      { id: 'a1', type: 'infection', title: 'Rotting Rookies turned', content: 'Lost to Last Light Brigade by 22.4 in week 4 and joined the Horde.', week: 4, createdAt: '2026-10-01T03:00:00.000Z' },
      { id: 'a2', type: 'revival', title: 'Night Shift is back', content: 'A serum at the right moment brought Jordan back to the living.', week: 8, createdAt: '2026-10-28T16:00:00.000Z' },
    ],
    latestResolution: { status: 'resolved', resolvedAt: '2026-11-04T10:00:00.000Z', requiresStatCorrection: false, week: 9 },
    topPerformers: [TEAMS[0], TEAMS[1], TEAMS[4]],
    dangerZone: [TEAMS[2], TEAMS[3]],
    recentInfections: [{ id: 'i1' }],
    recentBashings: [{ id: 'b1' }, { id: 'b2' }],
    recentMaulings: [{ id: 'm1' }],
    backgroundTheme: null,
  },
  winCards: [
    { role: 'Survivor', winnerName: 'Last Light Brigade', opponentName: 'Brains Trust', winnerScore: 141.2, opponentScore: 112.6, week: 9 },
    { role: 'Zombie', winnerName: 'Rotting Rookies', opponentName: 'The Barricade Collective of Greater Columbus', winnerScore: 88.1, opponentScore: 101.4, week: 9 },
  ],
  hordeSize: 3,
  survivorCount: 4,
  myTeam: TEAMS[0],
  myActiveItemCount: 3,
  myPendingItemCount: 1,
  myResources: { serums: 1, weapons: 2, activeItems: 3, pendingItems: 1 },
} satisfies Pack

/** What the shell reads from the same payload: commissioner badge and an unanswered sit-out. */
export const league = {
  ...PACK,
  viewerIsCommissioner: true,
  commissionerNotifications: { unread: 2, actionRequired: 1 },
  hordeSitOuts: { myPendingResponse: null },
} satisfies Pack & ZMeta

export const eventFeed = { animations: [] as FeedAnimation[] }

export const matchups = {
  week: 10,
  rules: { bashingThreshold: 30, maulingThreshold: 50, bashShare: 0.1, maulShare: 0.25 },
  matchups: [
    {
      id: 'mu1', home: { rosterId: 'r1', name: 'Last Light Brigade', status: 'Survivor', score: 118.4 },
      away: { rosterId: 'r6', name: 'Rotting Rookies', status: 'Zombie', score: 84.9 },
      final: false, margin: 33.5, leader: 'home', atRisk: 'home', outcome: { kind: 'bashing', final: false }, transfer: null, mySide: 'home',
    },
    {
      id: 'mu2', home: { rosterId: 'r3', name: 'The Barricade Collective of Greater Columbus', status: 'Survivor', score: 92.2 },
      away: { rosterId: 'r7', name: 'Brains Trust', status: 'Zombie', score: 96.0 },
      final: false, margin: 3.8, leader: 'away', atRisk: 'home', outcome: null, transfer: null, mySide: null,
    },
    {
      id: 'mu3', home: { rosterId: 'r2', name: 'Bunker Boys', status: 'Survivor', score: 104.0 },
      away: { rosterId: 'r5', name: 'Quiet Ones', status: 'Survivor', score: 101.7 },
      final: false, margin: 2.3, leader: 'home', atRisk: null, outcome: null, transfer: null, mySide: null,
    },
    {
      id: 'mu4', home: { rosterId: 'r4', name: 'Night Shift', status: 'Revived', score: 61.0 },
      away: { rosterId: 'r8', name: 'Shamblers FC', status: 'Zombie', score: 122.5 },
      final: false, margin: 61.5, leader: 'away', atRisk: 'home', outcome: { kind: 'mauling', final: false }, transfer: null, mySide: null,
    },
  ],
} satisfies MatchupsPayload

export const inventory = {
  appliedItemBonus: null,
  itemPolicy: 'beta_2025',
  week: 10,
  weekBecameZombie: null,
  teamStatus: 'Survivor',
  items: [
    { id: 'it1', teamStatusId: 'ts1', itemType: 'serum', itemLabel: 'Serum', isUsed: false, isExpired: false, acquiredAt: '2026-10-21T12:00:00.000Z', acquiredReason: 'Top score in week 7', activationState: 'ready', activatesAtWeek: 8, usedAtWeek: null },
    { id: 'it2', teamStatusId: 'ts1', itemType: 'weapon_knife', itemLabel: 'Knife', isUsed: false, isExpired: false, acquiredAt: '2026-10-14T12:00:00.000Z', acquiredReason: 'Scored 140+ in week 6', activationState: 'ready', activatesAtWeek: 7, usedAtWeek: null },
    { id: 'it3', teamStatusId: 'ts1', itemType: 'weapon_bow', itemLabel: 'Bow', isUsed: false, isExpired: false, acquiredAt: '2026-11-04T12:00:00.000Z', acquiredReason: 'Scored 150+ in week 9', activationState: 'pending_activation', activatesAtWeek: 11, usedAtWeek: null },
    { id: 'it4', teamStatusId: 'ts1', itemType: 'weapon_axe', itemLabel: 'Axe', isUsed: true, isExpired: false, acquiredAt: '2026-09-30T12:00:00.000Z', acquiredReason: 'Won by 40+ in week 4', activationState: 'ready', activatesAtWeek: 5, usedAtWeek: 6, usedEffect: 'Blocked a bashing' },
  ],
  rules: { reviveThreshold: 2, serumMaxHold: 3, weaponShieldThreshold: 140, weaponAmbushThreshold: 150, weaponAxeMargin: 40 },
  history: [
    { id: 'h1', actionType: 'weapon_used', week: 6, createdAt: '2026-10-14T18:00:00.000Z', isValid: true },
    { id: 'h2', actionType: 'serum_awarded', week: 7, createdAt: '2026-10-21T12:00:00.000Z', isValid: true },
  ],
  resolution: { status: 'resolved' },
  isCommissionerView: false,
  experienceMode: 'enhanced',
} satisfies InvPayload

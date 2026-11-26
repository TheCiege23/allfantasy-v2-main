/**
 * SAMPLE data for /e2e/draft-room-fixture. Every team, manager and player here is invented; none is a
 * real person or a real league. Shapes follow the room's own API contract (the same responses
 * e2e/helpers/draftRoomUsability.ts stubs per test), so the REAL room renders with no database.
 */
import type { DraftPickSnapshot, DraftSessionSnapshot, SlotOrderEntry } from '@/lib/live-draft-engine/types'

export const FIXTURE_LEAGUE_ID = 'e2e-fixture-draft'
const TEAMS = 10
const ROUNDS = 15
const MADE = 13 // picks already on the board; pick 14 (2.04, slot 7 in the snake) is the viewer's, on the clock
const VIEWER_ROSTER = 'fx-roster-7'

const MANAGERS = ['Mesa', 'Harbor', 'Juniper', 'Willow', 'Basalt', 'Cobalt', 'You', 'Quarry', 'Tundra', 'Saffron']

export const FIXTURE_SLOT_ORDER: SlotOrderEntry[] = MANAGERS.map((displayName, i) => ({
  slot: i + 1,
  rosterId: `fx-roster-${i + 1}`,
  displayName,
}))

/** Invented players, ADP order. */
const PLAYERS: Array<[string, string, string]> = [
  ['Atlas Runner', 'RB', 'NYJ'], ['Blaze Catcher', 'WR', 'DAL'], ['Core Signal', 'QB', 'KC'],
  ['Dune Sprinter', 'RB', 'ATL'], ['Ember Route', 'WR', 'MIN'], ['Flint Hands', 'WR', 'CIN'],
  ['Granite Back', 'RB', 'DET'], ['Harbor Deep', 'WR', 'MIA'], ['Iron Tight', 'TE', 'KC'],
  ['Jet Slot', 'WR', 'LAR'], ['Kestrel Arm', 'QB', 'BUF'], ['Lumen Cut', 'RB', 'SF'],
  ['Mason Seam', 'TE', 'BAL'], ['Nova Burst', 'RB', 'GB'], ['Orbit Fade', 'WR', 'PHI'],
  ['Pike Option', 'QB', 'PHI'], ['Quill Stretch', 'WR', 'HOU'], ['Ridge Power', 'RB', 'LV'],
  ['Slate Comeback', 'WR', 'SEA'], ['Thorn Wheel', 'TE', 'LAC'], ['Umber Dive', 'RB', 'NO'],
  ['Vale Post', 'WR', 'TB'], ['Wren Screen', 'RB', 'IND'], ['Xeno Fly', 'WR', 'ARI'],
  ['Yarrow Boot', 'QB', 'CHI'], ['Zephyr Leg', 'K', 'BAL'], ['Aspen Wall', 'DST', 'CLE'],
  ['Birch Flat', 'RB', 'JAX'], ['Cedar Curl', 'WR', 'NE'], ['Delta Edge', 'TE', 'SEA'],
]

function slotFor(overall: number): { round: number; slot: number; pickLabel: string } {
  const round = Math.ceil(overall / TEAMS)
  const inRound = ((overall - 1) % TEAMS) + 1
  const slot = round % 2 === 0 ? TEAMS - inRound + 1 : inRound
  return { round, slot, pickLabel: `${round}.${String(inRound).padStart(2, '0')}` }
}

export function fixturePoolEntries() {
  return PLAYERS.slice(MADE).map(([name, position, team], i) => ({
    playerId: `fx-p-${MADE + i + 1}`,
    name,
    position,
    team,
    adp: MADE + i + 1 + 0.4,
  }))
}

/**
 * `longClock`: a 4-hour pick clock with 3h05m left, so the room shows the long-clock extras (the
 * wall-clock "due" time beside the countdown, the planner cards). Open `?clock=long` to get it.
 */
export type FixtureOptions = { longClock?: boolean }

export function buildFixtureSnapshot(nowMs: number, opts: FixtureOptions = {}): DraftSessionSnapshot {
  const timerSeconds = opts.longClock ? 4 * 3600 : 90
  const remainingSeconds = opts.longClock ? 3 * 3600 + 5 * 60 : 55
  const iso = new Date(nowMs).toISOString()
  const picks: DraftPickSnapshot[] = PLAYERS.slice(0, MADE).map(([playerName, position, team], i) => {
    const overall = i + 1
    const s = slotFor(overall)
    const owner = FIXTURE_SLOT_ORDER[s.slot - 1]
    return {
      id: `fx-pick-${overall}`,
      overall,
      round: s.round,
      slot: s.slot,
      rosterId: owner.rosterId,
      displayName: owner.displayName,
      playerName,
      position,
      team,
      byeWeek: 5 + (i % 9),
      playerId: `fx-p-${overall}`,
      tradedPickMeta: null,
      source: owner.rosterId === VIEWER_ROSTER ? 'user' : 'auto',
      pickLabel: s.pickLabel,
      createdAt: new Date(nowMs - (MADE - i) * 60_000).toISOString(),
    }
  })
  const next = slotFor(MADE + 1)
  const onClock = FIXTURE_SLOT_ORDER[next.slot - 1]
  const endAt = new Date(nowMs + remainingSeconds * 1000).toISOString()
  return {
    id: 'fx-session-1',
    leagueId: FIXTURE_LEAGUE_ID,
    status: 'in_progress',
    draftType: 'snake',
    rounds: ROUNDS,
    teamCount: TEAMS,
    thirdRoundReversal: false,
    onClockTradeTimerBehavior: 'inherit_remaining',
    inDraftPlayerTradesEnabled: false,
    customRankingsEnabled: false,
    timerSeconds,
    timerEndAt: endAt,
    pausedRemainingSeconds: null,
    slotOrder: FIXTURE_SLOT_ORDER,
    tradedPicks: [],
    version: 1,
    picks,
    currentPick: {
      overall: MADE + 1,
      round: next.round,
      slot: next.slot,
      rosterId: onClock.rosterId,
      displayName: onClock.displayName,
      pickLabel: next.pickLabel,
    },
    timer: { status: 'running', remainingSeconds, timerEndAt: endAt },
    updatedAt: iso,
    currentUserRosterId: VIEWER_ROSTER,
    orphanRosterIds: [],
    aiManagerEnabled: false,
    orphanDrafterMode: 'cpu',
  }
}

/** Response bodies keyed by the path suffix after `/api/leagues/<id>/`, plus a few global paths. */
export function fixtureApiResponses(nowMs: number, opts: FixtureOptions = {}) {
  const snapshot = buildFixtureSnapshot(nowMs, opts)
  const pool = fixturePoolEntries()
  return {
    snapshot,
    league: {
      'draft/session': { leagueId: FIXTURE_LEAGUE_ID, session: snapshot },
      'draft/live-sync': { leagueId: FIXTURE_LEAGUE_ID, updated: false, updatedAt: snapshot.updatedAt, session: snapshot },
      'draft/events': { leagueId: FIXTURE_LEAGUE_ID, updated: false, updatedAt: snapshot.updatedAt, session: snapshot },
      'draft/pool': { entries: pool, sport: 'NFL', count: pool.length },
      'draft/queue': {
        leagueId: FIXTURE_LEAGUE_ID,
        queue: pool.slice(0, 3).map((p) => ({ playerName: p.name, position: p.position, team: p.team, playerId: p.playerId })),
      },
      'draft/chat': {
        messages: [{ id: 'fx-m1', from: 'Mesa', text: 'Good luck everyone.', at: snapshot.updatedAt }],
        syncActive: true,
      },
      'draft/settings': {
        config: { queue_size_limit: 50, autopick_behavior: 'skip' },
        draftUISettings: {
          draftOrderRandomizationEnabled: false,
          pickTradeEnabled: false,
          tradedPickColorModeEnabled: true,
          tradedPickOwnerNameRedEnabled: true,
          aiAdpEnabled: false,
          aiQueueReorderEnabled: false,
          orphanTeamAiManagerEnabled: false,
          orphanDrafterMode: 'cpu',
          liveDraftChatSyncEnabled: true,
          autoPickEnabled: false,
          timerMode: 'per_pick',
          slowDraftPauseWindow: null,
          commissionerForceAutoPickEnabled: false,
          commissionerPauseControlsEnabled: true,
        },
        idpRosterSummary: null,
        orphanStatus: { orphanRosterIds: [], recentActions: [] },
      },
      'roster-config': {
        starterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
        benchSlots: 6,
        taxiSlots: 0,
        devySlots: 0,
        orderedSlotLabels: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
      },
      privacy: { inviteLink: null, inviteCode: null },
      'claim-roster': { alreadyClaimed: true, rosters: [] },
      'draft/trade-proposals': { proposals: [] },
      'draft/assistant-context': {
        sport: 'NFL',
        headlines: [],
        injuries: [],
        sportsFeed: { available: false, updatedAt: null, sourceKeys: [], digest: null },
      },
    } as Record<string, unknown>,
    global: {
      '/api/auth/session': {},
      '/api/league/settings': {
        league: {
          teams: FIXTURE_SLOT_ORDER.map((e) => ({
            id: e.rosterId,
            rosterId: e.rosterId,
            teamName: `${e.displayName} FC`,
            ownerName: e.displayName,
            displayName: e.displayName,
          })),
        },
      },
      '/api/league/ai-opponents/summary': { aiManagedDraftRosterIds: [], assignments: [] },
      '/api/subscription/entitlements': {},
      '/api/tokens/balance': { balance: 0, updatedAt: snapshot.updatedAt },
      '/api/music/artists': { artists: [] },
      '/api/draft/live-brain': { ok: true, insights: [] },
      '/api/ai/draft/recommend': { ok: true, recommendation: null },
    } as Record<string, unknown>,
  }
}

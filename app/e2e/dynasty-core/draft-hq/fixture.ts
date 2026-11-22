/**
 * Fixture data for the /core dynasty Draft HQ harness (/e2e/dynasty-core/draft-hq). Every value is
 * invented for the screenshot. The rookie room is built by the REAL builder
 * (lib/core-app/draftHqRookieRoom.ts) and "Your picks" by the REAL `computePickInventory`, from
 * fixture rows shaped like what Draft HQ's loader reads (`DraftSession.slotOrder` / `tradedPicks`,
 * `LeagueSettings.draftDateUtc`, the future-pick inventory, `League.taxiSlots` + the roster taxi).
 */
import type { DraftHqData } from '@/lib/core-app/draftHq'
import { computePickInventory } from '@/lib/core-app/draftPickInventory'
import { buildRookieDraftRoom, type RookieRoomSession } from '@/lib/core-app/draftHqRookieRoom'

export const DYNASTY_DRAFT_HQ_LEAGUE = { id: 'e2e-dynasty-core-draft-hq', name: 'The Deep!' }

/** "Now" for the fixture, so the countdown is the same in every shot: 13 days before the draft. */
export const FIXTURE_NOW = new Date('2027-04-26T16:00:00.000Z')

const TEAMS = [
  'Gridiron Ghosts', 'Hoovi', 'Taco Tuesday', 'Waiver Wire Wizards', 'Bench Mob', 'Sunday Scaries',
  'Hail Mary Hounds', 'Red Zone Rebels', 'Fourth & Long', 'Blitz Brigade', 'Late Round QB', 'Couch Coaches',
]
const SLOT_ORDER = TEAMS.map((displayName, i) => ({ slot: i + 1, rosterId: `r${i + 1}`, displayName }))
const MINE = 'r9'

const name = (rosterId: string) => SLOT_ORDER.find((s) => s.rosterId === rosterId)!.displayName
const trade = (round: number, from: string, to: string) => ({
  round,
  originalRosterId: from,
  previousOwnerName: name(from),
  newRosterId: to,
  newOwnerName: name(to),
})

/** A 12-team, 4-round linear rookie draft: you bought a 1st and a 3rd, sold a 2nd; two rivals swapped a 1st. */
const SESSION: RookieRoomSession = {
  status: 'pre_draft',
  draftType: 'linear',
  rounds: 4,
  teamCount: 12,
  thirdRoundReversal: false,
  modeLabel: 'rookie',
  slotOrder: SLOT_ORDER,
  tradedPicks: [trade(1, 'r3', MINE), trade(2, MINE, 'r5'), trade(3, 'r1', MINE), trade(1, 'r12', 'r2')],
  myRosterId: MINE,
}

const missing = (reason: string) => ({ available: false as const, reason })

export function dynastyDraftHqFixture(opts: { identity: boolean; noDraft: boolean }): DraftHqData {
  const league = { id: DYNASTY_DRAFT_HQ_LEAGUE.id, name: DYNASTY_DRAFT_HQ_LEAGUE.name, platform: opts.noDraft ? 'sleeper' : 'manual', format: 'dynasty' }

  if (opts.noDraft) {
    // An imported dynasty league between drafts: no session here, picks from the synced inventory.
    const reason = 'no draft has been set up for this league'
    return {
      league,
      session: missing(reason),
      pickSlots: missing(reason),
      madePicks: missing(reason),
      board: missing(reason),
      grades: missing('Analysis requires data bound to this individual draft'),
      lottery: missing('this league sets its draft order without a lottery'),
      queue: missing('a prepared queue belongs to a draft AllFantasy runs, and none is set up for this league'),
      keepers: missing('this league keeps no players'),
      ...(opts.identity
        ? {
            rookieRoom: buildRookieDraftRoom({
              leagueSeason: 2026,
              session: null,
              draftDateUtc: null,
              leagueSettings: { dynasty_rookie_draft_calendar: { customOpenDate: '2027-05-01' } },
              inventory: {
                available: true,
                coverage: 'complete',
                bySeason: [
                  { season: 2027, picks: [
                    { round: 1, label: '1st', fromTeamName: null },
                    { round: 1, label: '1st', fromTeamName: 'Taco Tuesday' },
                    { round: 2, label: '2nd', fromTeamName: null },
                    { round: 4, label: '4th', fromTeamName: 'Bench Mob' },
                  ] },
                  { season: 2028, picks: [{ round: 1, label: '1st', fromTeamName: null }] },
                ],
              },
              taxi: { count: 4, slots: 4 },
              now: FIXTURE_NOW,
            }),
          }
        : {}),
    } as DraftHqData
  }

  const inventory = computePickInventory({
    myRosterId: MINE,
    slotOrder: SLOT_ORDER,
    tradedPicks: SESSION.tradedPicks,
    rounds: SESSION.rounds,
    teamCount: SESSION.teamCount,
    draftType: SESSION.draftType,
    thirdRoundReversal: false,
  })

  return {
    league,
    session: { available: true, data: { status: 'pre_draft', draftType: 'linear', rounds: 4, teamCount: 12, yourSlot: 9 } },
    pickSlots: { available: true, data: { ...inventory, note: null } },
    madePicks: missing('this draft has not run yet'),
    board: missing('Choose a completed draft in the archive to review its selections'),
    grades: missing('Analysis requires data bound to this individual draft'),
    lottery: {
      available: true,
      data: {
        pickCount: 3,
        playoffTeamCount: 6,
        fallbackOrder: 'reverse order of finish',
        fallbackMode: 'reverse_standings',
        alreadyRunAt: null,
        teams: [
          { rosterId: 'r3', name: 'Taco Tuesday', record: '3-11', oddsPercent: 25, isYou: false },
          { rosterId: 'r10', name: 'Blitz Brigade', record: '4-10', oddsPercent: 21.3, isYou: false },
          { rosterId: 'r7', name: 'Hail Mary Hounds', record: '5-9', oddsPercent: 17.5, isYou: false },
          { rosterId: 'r11', name: 'Late Round QB', record: '6-8', oddsPercent: 14.2, isYou: false },
          { rosterId: 'r9', name: 'Fourth & Long', record: '6-8', oddsPercent: 12.5, isYou: true },
          { rosterId: 'r6', name: 'Sunday Scaries', record: '7-7', oddsPercent: 9.5, isYou: false },
        ],
      },
    },
    queue: {
      available: true,
      data: {
        total: 14,
        players: [
          { rank: 1, playerName: 'Jeremiah Love', position: 'RB', team: null },
          { rank: 2, playerName: 'Carnell Tate', position: 'WR', team: null },
          { rank: 3, playerName: 'Fernando Mendoza', position: 'QB', team: null },
          { rank: 4, playerName: 'Jordyn Tyson', position: 'WR', team: null },
          { rank: 5, playerName: 'Kenyon Sadiq', position: 'TE', team: null },
        ],
      },
    },
    keepers: missing('this league keeps no players'),
    ...(opts.identity
      ? {
          rookieRoom: buildRookieDraftRoom({
            leagueSeason: 2027,
            session: SESSION,
            draftDateUtc: '2027-05-09T00:00:00.000Z',
            leagueSettings: {},
            inventory: null,
            taxi: { count: 2, slots: 4 },
            now: FIXTURE_NOW,
          }),
        }
      : {}),
  } as DraftHqData
}

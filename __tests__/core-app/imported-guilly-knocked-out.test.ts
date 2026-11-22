import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isGuillotineLeague, isTeamEliminated } from '@/lib/core-app/teamElimination'

/*
 * ESPN "Washington Pro Knockout PPR League" (565010384) as it stood on 2026-11-18: ESPN had knocked
 * the owner out in week 8 and the sync had emptied the roster, but the league row carried the Guilly
 * type only in the importer's column and the owner's confirmation — never in either native flag.
 */
const washington = {
  guillotineMode: false,
  leagueVariant: null,
  leagueType: 'guillotine',
  settings: { leagueTypeConfirmation: { type: 'guillotine', confirmedAt: '2026-11-08T03:02:00.478Z', suggestedAtConfirmation: 'redraft' } },
}
const emptied = { players: [], starters: [], reserve: [] }

describe('an imported Guilly league is a Guilly league', () => {
  it('knocks out the emptied ESPN roster the owner reported', () => {
    expect(isGuillotineLeague(washington)).toBe(true)
    expect(isTeamEliminated({ playerData: emptied, league: washington, eliminationRecorded: false })).toBe(true)
  })

  it('reads the leagueType column when nobody has confirmed the type', () => {
    expect(isGuillotineLeague({ guillotineMode: false, leagueVariant: null, leagueType: 'guillotine', settings: {} })).toBe(true)
    expect(isGuillotineLeague({ leagueType: 'Guillotine', settings: null })).toBe(true)
  })

  it('lets a confirmation that says otherwise win over the column', () => {
    const setBack = { ...washington, settings: { leagueTypeConfirmation: { type: 'redraft' } } }
    expect(isGuillotineLeague(setBack)).toBe(false)
    expect(isTeamEliminated({ playerData: emptied, league: setBack, eliminationRecorded: false })).toBe(false)
  })

  it('keeps a team with players alive, and an emptied redraft roster is not a chop', () => {
    expect(isTeamEliminated({ playerData: { players: ['4870653'] }, league: washington, eliminationRecorded: false })).toBe(false)
    expect(isTeamEliminated({ playerData: emptied, league: { leagueType: 'redraft', settings: {} }, eliminationRecorded: false })).toBe(false)
  })

  it('gives callers that pass only the native flags the answer they always got', () => {
    expect(isGuillotineLeague({ guillotineMode: false, leagueVariant: null })).toBe(false)
    expect(isGuillotineLeague({ guillotineMode: true, leagueType: 'redraft', settings: { leagueTypeConfirmation: { type: 'redraft' } } })).toBe(true)
  })
})

/*
 * The same league held two rosters for the owner's team: the current one (emptied by the knockout,
 * rewritten every sync) and one keyed by the ESPN manager id, frozen since 2026-09-17 with 15 players.
 * Both readers keep the first row they get, so the read must put the newest first.
 */
describe('the roster reads take the newest of duplicate rows', () => {
  // These sources are checked out with CRLF; the patterns are written in LF.
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

  it('Home and the league list (dash34) order the stored rosters newest first', () => {
    expect(src('lib/core-app/dash34.ts')).toMatch(
      /prisma\.roster\.findMany\(\{\n\s*where: \{ OR: rosterOr \},\n(?:\s*(?:\/\*|\*).*\n)*\s*orderBy: \{ updatedAt: 'desc' \},/,
    )
  })

  it('My Team orders its roster read newest first', () => {
    expect(src('lib/core-app/myTeam.ts')).toMatch(
      /prisma\.roster\.findFirst\(\{\n\s*where: \{ leagueId, platformUserId: \{ in: candidates \} \},\n(?:\s*(?:\/\*|\*).*\n)*\s*orderBy: \{ updatedAt: 'desc' \},/,
    )
  })
})

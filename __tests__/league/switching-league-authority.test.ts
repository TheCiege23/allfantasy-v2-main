import { describe, expect, it } from 'vitest'
import {
  hasTeamSwitched,
  isOfficialOnAllFantasy,
  readSwitchingState,
  SWITCHING_SETTINGS_KEY,
  withOfficial,
  withTeamSwitched,
} from '@/lib/league/switching/switchingLeague'
import {
  buildWriteAuthorityEnvelope,
  isShadowLeague,
  resolveTeamWriteAuthority,
  resolveWriteAuthority,
  shadowDisclosure,
} from '@/lib/league/write-authority'
import { AF_OWNED_LEAGUE_SETTINGS_KEYS } from '@/lib/league/afOwnedLeagueSettings'
import { SIDEBAR_SETTINGS_KEYS } from '@/lib/league/clientLeagueSettings'

const stamp = { at: '2026-11-26T12:00:00.000Z', byUserId: 'commish' }
const settingsWith = (state: unknown) => ({ scoring: 'ppr', [SWITCHING_SETTINGS_KEY]: state })
const official = settingsWith(withOfficial({}, stamp))
const officialWithTeam = settingsWith(withTeamSwitched(official, 'team-a', { at: stamp.at, byUserId: 'mgr-a' }))
const switchedNotOfficial = settingsWith(withTeamSwitched({}, 'team-a', { at: stamp.at, byUserId: 'mgr-a' }))

describe('the switching state', () => {
  it('reads nothing for a league that never started switching', () => {
    expect(readSwitchingState({ scoring: 'ppr' })).toBeNull()
    expect(isOfficialOnAllFantasy(null)).toBe(false)
  })

  it('records official once; the first stamp stands', () => {
    const again = withOfficial(official, { at: '2027-01-01T00:00:00.000Z', byUserId: 'someone-else' })
    expect(again.official).toEqual(stamp)
  })

  it('records a team switching, idempotently, and ignores malformed entries', () => {
    expect(hasTeamSwitched(officialWithTeam, 'team-a')).toBe(true)
    expect(hasTeamSwitched(officialWithTeam, 'team-b')).toBe(false)
    expect(hasTeamSwitched(officialWithTeam, null)).toBe(false)
    const again = withTeamSwitched(officialWithTeam, 'team-a', { at: 'later', byUserId: 'x' })
    expect(again.teams['team-a']).toEqual({ at: stamp.at, byUserId: 'mgr-a' })
    expect(readSwitchingState(settingsWith({ official: { at: 1 }, teams: { t: 'junk' } }))).toEqual({ official: null, teams: {} })
  })

  it('survives a re-import, and reaches the sidebar', () => {
    expect(AF_OWNED_LEAGUE_SETTINGS_KEYS).toContain(SWITCHING_SETTINGS_KEY)
    expect(SIDEBAR_SETTINGS_KEYS).toContain(SWITCHING_SETTINGS_KEY)
  })
})

describe('who is in charge of the league', () => {
  it('nothing changes for a league that never switched', () => {
    expect(resolveWriteAuthority({ platform: null, settings: null })).toBe('NATIVE')
    expect(resolveWriteAuthority({ platform: 'sleeper', settings: { scoring: 'ppr' } })).toBe('SHADOW')
    expect(resolveWriteAuthority({ platform: '', settings: null })).toBe('SHADOW')
  })

  it('an imported league made official is run by AllFantasy', () => {
    expect(resolveWriteAuthority({ platform: 'sleeper', settings: official })).toBe('NATIVE')
    expect(isShadowLeague({ platform: 'espn', settings: official })).toBe(false)
    expect(shadowDisclosure({ platform: 'espn', settings: official })).toBeNull()
    const envelope = buildWriteAuthorityEnvelope('lineup', { platform: 'sleeper', settings: official })
    expect(envelope).toMatchObject({ authority: 'NATIVE', shadow: false, platform: 'sleeper' })
    expect(envelope.copy.title).toBe('Lineup saved')
  })

  it('a manager switching does not make the league official on its own', () => {
    expect(resolveWriteAuthority({ platform: 'sleeper', settings: switchedNotOfficial })).toBe('SHADOW')
  })
})

describe('who is in charge of one team', () => {
  it('in an official league: a switched team is AllFantasy\'s, the rest are copied in', () => {
    const league = { platform: 'sleeper', settings: officialWithTeam }
    expect(resolveTeamWriteAuthority(league, 'team-a')).toBe('NATIVE')
    expect(resolveTeamWriteAuthority(league, 'team-b')).toBe('MIRRORED')
    expect(resolveTeamWriteAuthority(league, null)).toBe('MIRRORED')
  })

  it('before the league is official, a switched team is still practice only', () => {
    expect(resolveTeamWriteAuthority({ platform: 'sleeper', settings: switchedNotOfficial }, 'team-a')).toBe('SHADOW')
  })

  it('a native league has no copied-in teams, whatever its settings say', () => {
    expect(resolveTeamWriteAuthority({ platform: null, settings: official }, 'team-b')).toBe('NATIVE')
    expect(resolveTeamWriteAuthority({ platform: 'native', settings: null }, 'team-b')).toBe('NATIVE')
  })
})

describe('which teams a re-sync must leave alone', () => {
  const teams = [
    { id: 'team-a', externalId: '1' },
    { id: 'team-b', externalId: '2' },
  ]
  it('only switched teams, and only once the league is official', async () => {
    const { teamsRunOnAllFantasy } = await import('@/lib/league/switching/switchingLeague')
    expect([...teamsRunOnAllFantasy(officialWithTeam, teams)]).toEqual(['1'])
    expect(teamsRunOnAllFantasy(switchedNotOfficial, teams).size).toBe(0)
    expect(teamsRunOnAllFantasy(official, teams).size).toBe(0)
    expect(teamsRunOnAllFantasy({ scoring: 'ppr' }, teams).size).toBe(0)
  })
})

/**
 * Faces and crests in the draft room, per sport.
 *
 * Measured on 3c83857ea / the test DB, 2026-09-24:
 *   - every headshot builder made an NFL Sleeper URL from whatever id it was given. Outside NFL the
 *     pool's ids are Rolling Insights ids, and 42,031 of 42,032 that collide with a Sleeper id
 *     belong to a different person — an NBA card showed a stranger or a 404;
 *   - TheSportsDB/CFBD/API-Football photos exist for ~601 NBA, 1,127 NHL, 1,106 MLB, ~1,400 soccer
 *     and ~5,100 college football players, but only attached through position-keyed maps whose
 *     vocabularies never match ("Point Guard" vs "PG");
 *   - team logos came from a registry that turns any unknown value ("Memphis Grizzlies") into a
 *     guessed ESPN URL, while stored crests matched every pro team by name.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildHeadshotUrl } from '@/lib/player-media-urls'
import { resolveHeadshotUrl } from '@/lib/draft-sports-models/player-asset-resolver'
import { getPlayerImage } from '@/lib/players/getPlayerImage'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import { buildTeamLogoResolver } from '@/lib/draft-room/draftPoolTeamLogos'
import { isNonPlayerRosterRole, uniqueNamePhoto } from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import { rosteredPlayerSignal } from '@/lib/sport-teams/SportPlayerPoolResolver'

describe('headshots are built from an id only where the id is a Sleeper id', () => {
  it('NFL still gets its Sleeper URL (and a team code its logo)', () => {
    expect(buildHeadshotUrl('4984')).toBe('https://sleepercdn.com/content/nfl/players/thumb/4984.jpg')
    expect(buildHeadshotUrl('4984', 'NFL')).toContain('/nfl/players/thumb/4984.jpg')
    expect(buildHeadshotUrl('PHI', 'nfl')).toContain('team_logos/nfl/phi.png')
    expect(resolveHeadshotUrl('4984', 'NFL')).toContain('/nfl/players/thumb/4984.jpg')
  })

  it('no other sport builds a URL from an id', () => {
    for (const sport of ['NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER']) {
      expect(buildHeadshotUrl('4984', sport)).toBeNull()
      expect(resolveHeadshotUrl('4984', sport)).toBeNull()
      expect(getPlayerImage({ id: '4984', name: 'X', imageUrl: null }, sport)).toBeNull()
    }
    expect(getPlayerImage({ id: '4984', name: 'X', imageUrl: null }, 'NFL')).toContain('/nfl/players/thumb/')
  })

  it('an NBA pool row with a numeric id and no photo shows the placeholder, not a Sleeper face', () => {
    const entry = normalizeDraftPlayer({ name: 'Ja Morant', position: 'PG', team: 'MEM', sleeperId: '4984', playerId: '4984' }, 'NBA')
    expect(entry.display.assets.headshotUrl).not.toMatch(/sleepercdn/)
    expect(entry.display.assets.headshotFallbackUsed).toBe(true)
  })

  it('an NBA pool row with a stored photo keeps it', () => {
    const url = 'https://r2.thesportsdb.com/images/media/player/cutout/ja.png'
    const entry = normalizeDraftPlayer({ name: 'Ja Morant', position: 'PG', team: 'MEM', imageUrl: url }, 'NBA')
    expect(entry.display.assets.headshotUrl).toBe(url)
  })
})

describe('non-NFL photos by an unambiguous name', () => {
  const photos = (entries: Array<[string, string[]]>) => new Map(entries)

  it('takes the only photo the best source has for the name', () => {
    expect(uniqueNamePhoto(photos([['thesportsdb', ['a.png']], ['api_football', ['b.png']]]))).toBe('a.png')
  })

  it('refuses a name two people share in that source, without falling to a lower one', () => {
    expect(uniqueNamePhoto(photos([['thesportsdb', ['a.png', 'b.png']], ['cfbd', ['c.png']]]))).toBeNull()
  })

  it('the same person listed twice in a source is still one photo', () => {
    expect(uniqueNamePhoto(photos([['thesportsdb', ['a.png', 'a.png']]]))).toBe('a.png')
  })

  it('does not take a coach or owner as a player', () => {
    for (const role of ['Assistant Coach', 'Owner', 'General Manager', 'President', 'Associate HC']) {
      expect(isNonPlayerRosterRole(role)).toBe(true)
    }
    for (const pos of ['Point Guard', 'Defenceman', 'Goaltender', 'Centre-Forward', 'Starting Pitcher']) {
      expect(isNonPlayerRosterRole(pos)).toBe(false)
    }
  })
})

describe('stored team crests', () => {
  const rows = [
    { externalId: '1', name: 'Memphis Grizzlies', shortName: 'MEM', city: null, logo: 'https://x/mem.png', source: 'rolling_insights' },
    { externalId: 'c1', name: 'Miami', shortName: 'MIA', city: null, logo: 'https://x/miami-fl.png', source: 'cfbd' },
    { externalId: 'c2', name: 'Miami (OH)', shortName: 'M-OH', city: null, logo: 'https://x/miami-oh.png', source: 'cfbd' },
    { externalId: 'c3', name: 'Auburn', shortName: 'AUB', city: null, logo: 'https://x/auburn.png', source: 'cfbd' },
    { externalId: 'c4', name: 'Navy', shortName: 'NAVY', city: null, logo: 'https://x/navy.png', source: 'cfbd' },
    { externalId: 's1', name: 'Arsenal', shortName: 'ARS', city: null, logo: 'https://x/ars.png', source: 'api_football' },
    { externalId: '7', name: 'Arsenal FC', shortName: null, city: null, logo: null, source: 'rolling_insights' },
  ]
  const resolve = buildTeamLogoResolver(rows)

  it('matches a pro team by its full name or abbreviation', () => {
    expect(resolve('Memphis Grizzlies')).toBe('https://x/mem.png')
    expect(resolve('MEM')).toBe('https://x/mem.png')
  })

  it('matches a formal college name to the logo source’s short one', () => {
    expect(resolve('Auburn University')).toBe('https://x/auburn.png')
    expect(resolve('University of Miami')).toBe('https://x/miami-fl.png')
    expect(resolve('United States Naval Academy')).toBe('https://x/navy.png')
  })

  it('does not give Miami University (Ohio) the Florida crest', () => {
    expect(resolve('Miami University')).toBe('https://x/miami-oh.png')
  })

  it('maps a soccer team id to its club’s crest', () => {
    expect(resolve('7')).toBe('https://x/ars.png')
  })

  it('returns nothing for a team it cannot place, rather than a guessed URL', () => {
    expect(resolve('Unknown Tech Institute')).toBeNull()
    expect(resolve('999')).toBeNull()
  })
})

describe('non-NFL pool order without ADP', () => {
  it('ranks a rostered player with a photo above a free agent, and above a bare row', () => {
    const star = rosteredPlayerSignal({ team: 'Memphis Grizzlies', imageUrl: 'https://x/ja.png' })
    const rostered = rosteredPlayerSignal({ team: 'Memphis Grizzlies', imageUrl: null })
    const freeAgent = rosteredPlayerSignal({ team: 'FA', imageUrl: 'https://x/fa.png' })
    const bare = rosteredPlayerSignal({ team: null, imageUrl: null })
    expect(star).toBeGreaterThan(rostered)
    expect(rostered).toBeGreaterThan(freeAgent)
    expect(freeAgent).toBeGreaterThan(bare)
  })
})

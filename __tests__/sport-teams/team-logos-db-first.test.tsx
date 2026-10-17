import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/*
 * Team logos outside the NFL. ESPN keys college and soccer crests by NUMERIC id, so every
 * abbreviation/name guess for those sports 404s (measured 2026-10-01: `ncaaf/500/ala.png`,
 * `ncaab/500/duke.png`, `soccer/500/mia.png`). Those guesses used to be tried, fail, and land on
 * `/default-avatar.png` — a PERSON silhouette where a team crest belongs, and the initials fallback
 * never showed because the avatar always loaded.
 */

const findMany = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsTeam: { findMany: (...args: unknown[]) => findMany(...args) } },
}))

import { isKnownDeadLogoGuess, liveLogoOrNull } from '@/lib/sport-teams/knownDeadLogoGuess'
import { getTeamLogoCandidates, getTeamLogoUrl, isNoTeam } from '@/lib/players/teamLogos'
import { TeamLogo } from '@/app/components/TeamLogo'
import { clearStoredTeamLogoCache, getStoredTeamLogoResolver } from '@/lib/sport-teams/storedTeamLogos'

describe('isKnownDeadLogoGuess', () => {
  it('flags college and soccer paths keyed by letters', () => {
    expect(isKnownDeadLogoGuess('https://a.espncdn.com/i/teamlogos/ncaaf/500/ala.png')).toBe(true)
    expect(isKnownDeadLogoGuess('https://a.espncdn.com/i/teamlogos/ncaab/500/duke.png')).toBe(true)
    expect(isKnownDeadLogoGuess('https://a.espncdn.com/i/teamlogos/soccer/500/mia.png')).toBe(true)
  })

  it('keeps numeric-id crests and every pro-league path', () => {
    expect(isKnownDeadLogoGuess('https://a.espncdn.com/i/teamlogos/ncaa/500/333.png')).toBe(false)
    expect(isKnownDeadLogoGuess('https://a.espncdn.com/i/teamlogos/soccer/500/359.png')).toBe(false)
    expect(isKnownDeadLogoGuess('https://a.espncdn.com/i/teamlogos/nfl/500/kc.png')).toBe(false)
    expect(isKnownDeadLogoGuess('https://a.espncdn.com/i/teamlogos/nba/500/mem.png')).toBe(false)
    expect(isKnownDeadLogoGuess(null)).toBe(false)
  })

  it('liveLogoOrNull drops only the dead guess', () => {
    expect(liveLogoOrNull(' https://a.espncdn.com/i/teamlogos/ncaaf/500/ala.png ')).toBeNull()
    expect(liveLogoOrNull('https://r2.example/crest.png')).toBe('https://r2.example/crest.png')
    expect(liveLogoOrNull('')).toBeNull()
  })
})

describe('getTeamLogoCandidates / getTeamLogoUrl', () => {
  it.each(['NCAAF', 'NCAAFB', 'NCAAB', 'NCAABB', 'SOCCER', 'EPL'])('guesses nothing for %s', (sport) => {
    expect(getTeamLogoCandidates('Ohio State University', sport)).toEqual([])
    expect(getTeamLogoCandidates('ALA', sport)).toEqual([])
    expect(getTeamLogoUrl('ALA', sport)).toBeNull()
  })

  it('still guesses for the NFL, and never offers the person avatar', () => {
    const urls = getTeamLogoCandidates('KC', 'NFL')
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.some((u) => u.includes('/nfl/'))).toBe(true)
    expect(urls).not.toContain('/default-avatar.png')
    expect(getTeamLogoUrl('KC', 'NFL')).toMatch(/^https:\/\//)
  })

  it('a non-team has no logo', () => {
    for (const t of ['', 'FA', 'free agent', 'N/A', '—']) {
      expect(isNoTeam(t)).toBe(true)
      expect(getTeamLogoCandidates(t, 'NFL')).toEqual([])
      expect(getTeamLogoUrl(t, 'NFL')).toBeNull()
    }
    expect(isNoTeam('KC')).toBe(false)
  })
})

describe('TeamLogo', () => {
  it('shows a college team\'s initials, not an image, when it has no stored crest', () => {
    const html = renderToStaticMarkup(<TeamLogo teamAbbr="Ohio State University" sport="NCAAF" />)
    expect(html).not.toContain('<img')
    expect(html).toContain('>OS<')
  })

  it('uses a passed stored crest', () => {
    const html = renderToStaticMarkup(
      <TeamLogo teamAbbr="Real Madrid" sport="SOCCER" logoUrl="https://a.espncdn.com/i/teamlogos/soccer/500/86.png" />,
    )
    expect(html).toContain('src="https://a.espncdn.com/i/teamlogos/soccer/500/86.png"')
  })

  it('ignores a passed logo that is a known-dead guess', () => {
    const html = renderToStaticMarkup(
      <TeamLogo teamAbbr="Duke" sport="NCAAB" logoUrl="https://a.espncdn.com/i/teamlogos/ncaab/500/duke.png" />,
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('>DU<')
  })

  it('renders the dash for a free agent', () => {
    expect(renderToStaticMarkup(<TeamLogo teamAbbr="FA" sport="NFL" />)).toContain('—')
  })
})

describe('getStoredTeamLogoResolver', () => {
  beforeEach(() => {
    clearStoredTeamLogoCache()
    findMany.mockReset()
  })

  it('maps Rolling Insights college codes onto the stored sport and caches per sport', async () => {
    findMany.mockResolvedValue([
      { externalId: '194', name: 'Ohio State Buckeyes', shortName: 'Ohio State', city: null, logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/194.png', source: 'cfbd' },
    ])
    const resolve = await getStoredTeamLogoResolver('NCAAFB', 1_000)
    expect(findMany.mock.calls[0]![0].where).toEqual({ sport: 'NCAAF' })
    expect(resolve('Ohio State')).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500/194.png')

    await getStoredTeamLogoResolver('NCAAF', 2_000)
    expect(findMany).toHaveBeenCalledTimes(1)
    await getStoredTeamLogoResolver('NCAAF', 1_000 + 11 * 60 * 1000)
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('a database failure resolves to "no logo", never a rejection', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    const resolve = await getStoredTeamLogoResolver('NBA', 1_000)
    expect(resolve('Memphis Grizzlies')).toBeNull()
  })
})

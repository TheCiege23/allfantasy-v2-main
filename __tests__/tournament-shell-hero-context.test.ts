/**
 * A league in a tournament shell gets the league page's tournament banner
 * (lib/tournament/shellHeroContext.ts). The 26 linked KingBuffalo leagues had none.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shellTournamentHeroContext } from '@/lib/tournament/shellHeroContext'

describe('shellTournamentHeroContext', () => {
  it('names the tournament, the conference and the round, and links to the shell hub', () => {
    expect(shellTournamentHeroContext({
      tournament: { id: 'shell-1', name: ' KingBuffalo Tournament 2026 ' },
      conference: { name: 'Black', theme: null, bannerUrl: null, colorHex: null },
      round: { roundNumber: 1, roundLabel: 'Regular season', roundType: 'opening' },
    })).toEqual({
      tournamentId: 'shell-1',
      tournamentName: 'KingBuffalo Tournament 2026',
      conferenceName: 'Black',
      conferenceTheme: '',
      roundIndex: 1,
      phase: 'Regular season',
      hubHref: '/tournament-hub/shell-1',
      controlHref: null,
      theme: null,
    })
  })
  it('carries the conference banner and colour when it has them', () => {
    const out = shellTournamentHeroContext({
      tournament: { id: 's', name: 'T' },
      conference: { name: 'Gold', theme: 'gold', bannerUrl: 'https://example.test/b.png', colorHex: '#d4af37' },
      round: null,
    })
    expect(out?.theme).toMatchObject({ bannerUrl: 'https://example.test/b.png', accentColor: '#d4af37' })
    expect(out).toMatchObject({ phase: 'Tournament', roundIndex: 1, conferenceTheme: 'gold' })
  })
  it('has nothing to say without a tournament', () => {
    expect(shellTournamentHeroContext(null)).toBeNull()
    expect(shellTournamentHeroContext({ tournament: { id: 's', name: '  ' }, conference: null, round: null })).toBeNull()
  })
})

describe('where it is used', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('the context route falls back to the shell only when the older tables have nothing', () => {
    const route = read('app/api/leagues/[leagueId]/tournament-context/handler.ts')
    expect(route).toMatch(/^\s*if \(!config\) \{$/m)
    expect(route).toMatch(/^\s*return NextResponse\.json\(\{ tournament: shellTournamentHeroContext\(shellLeague\) \}\)$/m)
  })
  it('the hero follows the context links instead of assuming the older paths', () => {
    const hero = read('components/league-home/SpecialtyLeagueHomeHero.tsx')
    expect(hero).toMatch(/^\s*href=\{tournamentContext\.hubHref \?\? `\/tournament\/\$\{tournamentContext\.tournamentId\}`\}$/m)
    expect(hero).toMatch(/tournamentContext\.controlHref !== null \? \($/m)
  })
})

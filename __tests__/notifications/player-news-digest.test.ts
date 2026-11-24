import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
import { digestDue, renderPlayerNewsDigest, toItem, tidyTeamName, DIGEST_LOCAL_HOUR, type DigestItem } from '@/lib/notifications/playerNewsDigest'

const item = (patch: Partial<DigestItem>): DigestItem => ({ leagueId: 'L1', leagueName: 'KBFL', playerName: 'P', team: 'DET', position: 'RB', status: 'out', starter: false, headline: 'h', createdAt: new Date(), ...patch })

describe('the daily Roster news email', () => {
  it('is due from 8am in the person’s own timezone', () => {
    expect(DIGEST_LOCAL_HOUR).toBe(8)
    expect(digestDue(new Date('2026-10-22T11:59:00Z'), 'America/New_York')).toEqual({ due: false, day: '2026-10-22' })
    expect(digestDue(new Date('2026-10-22T12:00:00Z'), 'America/New_York')).toEqual({ due: true, day: '2026-10-22' })
    expect(digestDue(new Date('2026-10-22T12:00:00Z'), 'America/Los_Angeles').due).toBe(false)
    // An unreadable timezone falls back to Eastern rather than throwing.
    expect(digestDue(new Date('2026-10-22T12:00:00Z'), 'Not/AZone').due).toBe(true)
  })
  it('groups by league, starters first, then team, and escapes what it prints', () => {
    const out = renderPlayerNewsDigest([
      item({ playerName: 'Bench B', team: 'MIN', headline: 'limited' }),
      item({ playerName: 'Starter S', starter: true, headline: 'ruled out <Sunday>' }),
      item({ leagueId: null, leagueName: null, playerName: 'Followed F', headline: 'traded' }),
    ], 'https://allfantasy.ai')
    expect(out.subject).toBe('Roster news: 3 updates · 1 about your starters')
    const html = out.html
    expect(html.indexOf('KBFL')).toBeLessThan(html.indexOf('Players you follow'))
    expect(html.indexOf('Starter S')).toBeLessThan(html.indexOf('Bench B'))
    expect(html).toContain('ruled out &lt;Sunday&gt;')
    expect(html).toContain('(RB · DET)')
    expect(out.body.split('\n')[1]).toBe('⭐ Starter S: ruled out <Sunday>')
  })

  it('files a team-follow story under that team, never under "Players you follow" (2026-11-24)', () => {
    // The real row: a Celtics fan who follows no player and plays no fantasy basketball.
    const row = {
      id: 'n1', leagueId: null, title: '📰 Player News: Paul George', createdAt: new Date(),
      body: "Fantasy notebook: Karabell on Paul George, Tyler Herro, De'Aaron Fox, more",
      meta: { team: 'BOS', sport: 'NBA', followedTeam: 'BOS', notificationCategory: 'followed_teams',
        playerNews: { team: 'BOSTON CELTICS', status: 'news:player_news', starter: false, delivery: 'instant', position: 'SF', playerName: 'Paul George' } },
    }
    const it = toItem(row, new Map())!
    expect(it.followedTeam).toBe('Boston Celtics')
    const out = renderPlayerNewsDigest([it], 'https://allfantasy.ai')
    expect(out.html).toContain('Boston Celtics · a team you follow')
    expect(out.html).not.toContain('Players you follow')
    expect(out.html).toContain('(SF · Boston Celtics)')
    expect(out.html).not.toContain('waited for this email')
    expect(out.html).not.toContain('starting lineup')
  })
  it('a player follow or a league row is not a team follow, and sections run league → players → teams', () => {
    const base = { id: 'x', title: 't', body: 'b', createdAt: new Date() }
    expect(toItem({ ...base, leagueId: null, meta: { playerNews: { playerName: 'A' } } }, new Map())!.followedTeam).toBeNull()
    expect(toItem({ ...base, leagueId: 'L1', meta: { followedTeam: 'BOS', playerNews: { playerName: 'A' } } }, new Map([['L1', 'KBFL']]))!.followedTeam).toBeNull()
    const html = renderPlayerNewsDigest([
      item({ leagueId: null, leagueName: null, followedTeam: 'Boston Celtics', playerName: 'Team T' }),
      item({ leagueId: null, leagueName: null, playerName: 'Followed F' }),
      item({ playerName: 'League L', starter: true }),
    ], 'https://allfantasy.ai').html
    expect(html.indexOf('KBFL')).toBeLessThan(html.indexOf('Players you follow'))
    expect(html.indexOf('Players you follow')).toBeLessThan(html.indexOf('a team you follow'))
    expect(html).toContain('starting lineup')
  })
  it('tidies an all-caps team name and leaves abbreviations alone', () => {
    expect(tidyTeamName('BOSTON CELTICS')).toBe('Boston Celtics')
    expect(tidyTeamName('BOS')).toBe('BOS')
    expect(tidyTeamName('Los Angeles Clippers')).toBe('Los Angeles Clippers')
    expect(tidyTeamName('  ')).toBeNull()
  })
})

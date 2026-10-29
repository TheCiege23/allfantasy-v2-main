import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
import { digestDue, renderPlayerNewsDigest, DIGEST_LOCAL_HOUR, type DigestItem } from '@/lib/notifications/playerNewsDigest'

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
})

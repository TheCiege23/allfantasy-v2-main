import { describe, expect, it } from 'vitest'
import {
  buildShareCardContent,
  headlineFontSize,
  ordinal,
  safeIdolId,
  shareBackgroundPath,
  statsForFormat,
} from '@/lib/survivor/shareCards/cardContent'
import { isMomentOfferedTo, isMomentPublic, momentImageAccess } from '@/lib/survivor/shareCards/momentAccess'
import type { ShareMomentPayload } from '@/lib/survivor/shareCards/types'

const payload = (extra: Partial<ShareMomentPayload> = {}): ShareMomentPayload => ({
  v: 1, displayName: 'Open Team 5', leagueName: 'Blah Survivor', sport: 'NFL', season: 2026, tribeName: 'Vela', crestPath: null, ...extra,
})

describe('share card content', () => {
  it('matches the reference immunity card copy and stats', () => {
    const c = buildShareCardContent('immunity', 6, payload({ points: 142.6, rank: 1, rankScope: 'tribe', immunityWins: 2 }))
    expect(c.kicker).toBe('Immunity · Week 6')
    expect(c.headline).toBe('Open Team 5 is safe')
    expect(c.sub).toBe('Top score in Tribe Vela. Can’t receive votes this week.')
    expect(c.stats).toEqual([{ value: '142.6', label: 'Points' }, { value: '1st', label: 'In tribe' }, { value: '2', label: 'Wins' }])
    expect(c.heroPath).toBe('/survivor/weekly/immunity-necklace.svg')
    expect(c.backgroundPath).toBe('/survivor/backgrounds/dusk-football.svg')
    expect(c.footerSport).toBe('NFL 2026')
  })

  it('picks the background by mood and the league sport', () => {
    expect(buildShareCardContent('out', 6, payload({ sport: 'NHL' })).backgroundPath).toBe('/survivor/backgrounds/night-hockey.svg')
    expect(buildShareCardContent('exile', 6, payload({ sport: 'NBA' })).backgroundPath).toBe('/survivor/backgrounds/exile-basketball.svg')
    expect(buildShareCardContent('champ', 13, payload({ sport: 'MLB' })).backgroundPath).toBe('/survivor/backgrounds/day-baseball.svg')
    expect(shareBackgroundPath('dusk', 'unknown')).toBe('/survivor/backgrounds/dusk-football.svg')
  })

  it('uses the played idol’s own art, never a hard-coded immunity idol', () => {
    expect(buildShareCardContent('idol', 6, payload({ idolId: 'extra-vote', idolName: 'Extra Vote' })).heroPath).toBe('/survivor/idols/extra-vote.svg')
    expect(safeIdolId('../../etc/passwd')).toBe('immunity')
  })

  it('formats the out card from the public tally only', () => {
    const c = buildShareCardContent('out', 6, payload({ displayName: 'Open Team 8', tally: '2–1', weeks: 6, points: 96.2, next: 'exile' }))
    expect(c.headline).toBe('Open Team 8’s torch is out')
    expect(c.sub).toBe('Voted out 2–1 at Tribal Council. Heading to Exile Island.')
    expect(c.stats.map(s => s.label)).toEqual(['Vote', 'Weeks', 'Points'])
  })

  it('shows at most two stat tiles on the link format', () => {
    const c = buildShareCardContent('champ', 13, payload({ tally: '3–1–1', weeks: 13, immunityWins: 3, points: 1412.6 }))
    expect(statsForFormat(c, 'post')).toHaveLength(3)
    expect(statsForFormat(c, 'link')).toHaveLength(2)
    expect(c.stats[2].value).toBe('1,412.6')
  })

  it('steps the Cinzel size down for long names', () => {
    expect(headlineFontSize('post', 'Open Team 5 is safe')).toBe(84)
    expect(headlineFontSize('story', 'Open Team 5 is safe')).toBe(100)
    expect(headlineFontSize('link', 'Open Team 5 is safe')).toBe(54)
    expect(headlineFontSize('post', 'Commissioner Extraordinaire McGee is the last one standing')).toBeLessThan(84)
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(12)).toBe('12th')
  })
})

describe('share moment access rules', () => {
  const out = { type: 'out' as const, subjectUserId: 'voted-out', final: true, publishedAt: null }
  const champ = { type: 'champ' as const, subjectUserId: 'winner', final: true, publishedAt: null }

  it('offers the out card only to the eliminated manager', () => {
    expect(isMomentOfferedTo(out, { userId: 'voted-out', isLeagueMember: true })).toBe(true)
    expect(isMomentOfferedTo(out, { userId: 'someone-else', isLeagueMember: true })).toBe(false)
    expect(isMomentOfferedTo(out, { userId: null, isLeagueMember: false })).toBe(false)
  })

  it('offers the champion card to the whole league as a recap', () => {
    expect(isMomentOfferedTo(champ, { userId: 'any-member', isLeagueMember: true })).toBe(true)
    expect(isMomentOfferedTo(champ, { userId: 'outsider', isLeagueMember: false })).toBe(false)
  })

  it('is public only when final, published and the league allows sharing', () => {
    expect(isMomentPublic({ ...out, publishedAt: new Date() }, true)).toBe(true)
    expect(isMomentPublic({ ...out, publishedAt: new Date() }, false)).toBe(false)
    expect(isMomentPublic({ ...out, final: false, publishedAt: new Date() }, true)).toBe(false)
    expect(isMomentPublic(out, true)).toBe(false)
  })

  it('serves an unpublished out card privately to its subject and 404s everyone else', () => {
    expect(momentImageAccess(out, true, { userId: 'voted-out', isLeagueMember: true })).toBe('private')
    expect(momentImageAccess(out, true, { userId: 'someone-else', isLeagueMember: true })).toBe('not_found')
    expect(momentImageAccess(out, false, { userId: 'voted-out', isLeagueMember: true })).toBe('not_found')
    expect(momentImageAccess({ ...out, final: false }, true, { userId: 'voted-out', isLeagueMember: true })).toBe('not_found')
    expect(momentImageAccess(null, true, { userId: 'voted-out', isLeagueMember: true })).toBe('not_found')
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { maulingMoment, planItemMoments } from '@/lib/zombie/beta2025Moments'
import { zombieClipForAnimation } from '@/lib/zombie/videoAssets'
import { metaClip } from '@/lib/hooks/useZombieAnimationSse'
import { LeagueClipOverlay } from '@/components/league/LeagueClipOverlay'

/*
 * Maulings, bombs and weapons had no visual under the 2025 rules every NFL zombie league uses (2026-11-23).
 * They have no video file, so they play as an animated card from the row's own text.
 */
const names = new Map([['RA', 'Alpha'], ['RB', 'Bravo'], ['RC', 'Charlie'], ['RD', 'Delta']])
const base = {
  leagueId: 'L',
  week: 5,
  teams: [{ id: 'TA', rosterId: 'RA' }, { id: 'TB', rosterId: 'RB' }, { id: 'TC', rosterId: 'RC' }, { id: 'TD', rosterId: 'RD' }],
  owners: [{ rosterId: 'RA', userId: 'ua' }, { rosterId: 'RB', userId: 'ub' }, { rosterId: 'RC', userId: 'uc' }, { rosterId: 'RD', userId: null }],
}
const match = (id: string, home: string, away: string, hs: number, as: number, hw = 0, aw = 0) => ({
  matchupId: id, homeRosterId: home, awayRosterId: away, homeScore: hs, awayScore: as,
  homeBaseScore: hs - hw, awayBaseScore: as - aw, homeWeaponBonus: hw, awayWeaponBonus: aw,
})

describe('which 2025-rules moments a week shows', () => {
  it('a weapon that decided the matchup shows; one that did not, does not', () => {
    const moments = planItemMoments({ ...base, items: [], transfers: [],
      matchups: [match('m1', 'RA', 'RB', 110, 104, 10, 0), match('m2', 'RC', 'RD', 130, 100, 10, 0)] }, names)
    expect(moments.map((m) => m.type)).toEqual(['weapon_used'])
    expect(moments[0]).toMatchObject({ primary: 'ua', secondary: 'ub', meta: { detail: 'Alpha beat Bravo by 6. Weapons added +10.', displayMode: 'inline' } })
  })

  it('a bomb used this week shows at settlement, and takes the place of the weapon moment', () => {
    const items = [
      { id: 'bomb', teamStatusId: 'TA', itemType: 'weapon_bomb', usedAtWeek: 5, usedEffect: 'beta2025_bomb_35' },
      { id: 'old', teamStatusId: 'TC', itemType: 'weapon_bomb', usedAtWeek: 4, usedEffect: 'beta2025_bomb_35' },
    ]
    const moments = planItemMoments({ ...base, items, transfers: [], matchups: [match('m1', 'RA', 'RB', 120, 100, 35, 0)] }, names)
    expect(moments.map((m) => m.type)).toEqual(['bomb_detonated'])
    expect(moments[0].meta).toMatchObject({ icon: '💣', detail: 'Alpha set off a bomb: +35 points this week.', displayMode: 'fullscreen' })
  })

  it('a stolen weapon shows; a stolen serum does not', () => {
    const items = [{ id: 'gun', teamStatusId: 'TB', itemType: 'weapon_gun' }, { id: 'vial', teamStatusId: 'TB', itemType: 'serum' }]
    const transfers = [{ itemId: 'gun', fromRosterId: 'RB', toRosterId: 'RA' }, { itemId: 'vial', fromRosterId: 'RB', toRosterId: 'RA' }]
    const moments = planItemMoments({ ...base, items, transfers, matchups: [] }, names)
    expect(moments.map((m) => m.type)).toEqual(['weapon_stolen'])
    expect(moments[0].meta.detail).toBe('Alpha took 🔫 Gun from Bravo.')
    expect(moments[0].meta.icon).toBe('🔫')
  })

  it('a team with no AllFantasy manager is not named as the one who did it', () => {
    const moments = planItemMoments({ ...base, items: [], transfers: [], matchups: [match('m1', 'RD', 'RC', 110, 104, 10, 0)] }, names)
    expect(moments).toEqual([])
  })

  it('a mauling names both teams and the margin', () => {
    expect(maulingMoment({ winner: 'Alpha', loser: 'Bravo', margin: 64.5 })).toMatchObject({ icon: '🧟', title: 'Mauled', detail: 'Alpha mauled Bravo by 64.5 points.' })
  })
})

describe('how a moment reaches the screen', () => {
  it('maulings, bombs and weapons play as a card; the video moments keep their video', () => {
    for (const t of ['mauling', 'bomb_detonated', 'weapon_used', 'weapon_stolen']) expect(zombieClipForAnimation(t)).toEqual({ url: `card:${t}`, type: 'card' })
    expect(zombieClipForAnimation('bashing')?.type).toBe('video')
    expect(zombieClipForAnimation('player_revived')?.type).toBe('video')
  })

  it('the card shows the icon, title and what happened', () => {
    const meta = { clipUrl: 'card:bomb_detonated', clipType: 'card', icon: '💣', title: 'Bomb!', detail: 'Alpha set off a bomb.', anim: 'bomb' }
    const m = metaClip(meta)
    render(<LeagueClipOverlay open onClose={() => {}} payload={{ id: 'a', clipUrl: m.clipUrl!, clipType: m.clipType, title: m.title!, detail: m.detail!, icon: m.icon!, anim: m.anim!, displayMode: m.displayMode }} />)
    const card = screen.getByTestId('league-clip-card')
    expect(card.textContent).toContain('💣')
    expect(card.textContent).toContain('Bomb!')
    expect(card.textContent).toContain('Alpha set off a bomb.')
    expect(card.className).toContain('bomb-anim')
    expect(screen.queryByText('Unsupported clip type.')).toBeNull()
  })

  it('still shows the card with reduced motion on (only the motion is dropped)', () => {
    render(<LeagueClipOverlay open onClose={() => {}} payload={{ id: 'b', clipUrl: 'card:mauling', clipType: 'card', title: 'Mauled', detail: 'Alpha mauled Bravo.', icon: '🧟', anim: 'mauling', reducedMotion: true }} />)
    expect(screen.getByTestId('league-clip-card').textContent).toContain('Alpha mauled Bravo.')
  })

  it('a video moment shows its caption under the video', () => {
    render(<LeagueClipOverlay open onClose={() => {}} payload={{ id: 'c', clipUrl: '/zombie/videos/bashing/bashing.mp4', clipType: 'video', title: 'Bashing', detail: 'Alpha bashed Bravo by 61 points.' }} />)
    expect(screen.getByTestId('league-clip-detail').textContent).toBe('Alpha bashed Bravo by 61 points.')
  })
})

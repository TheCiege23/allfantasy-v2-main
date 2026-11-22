/**
 * The player card's bio and news (2026-11-21): stored rows, merged by source trust, shown on the
 * card. Every card used to show "—" for age, height, weight, experience and college, and "No recent
 * news." for every player.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/app/draft-room/PlayerAvatar', () => ({ PlayerAvatar: () => null }))

import { heightInches, mergeCardBio, rowsForPlayer, weightPounds, type CardBioRow } from '@/lib/players/playerCardBio'
import { PlayerDetailModal } from '@/components/app/draft-room/PlayerDetailModal'

// Derrick Henry's rows as stored on 2026-11-21, one per source.
const henry: CardBioRow[] = [
  { source: 'thesportsdb', sleeperId: '3198', name: 'Derrick Henry', position: 'RB', team: 'Baltimore Ravens', age: 32, yearsExp: null, height: '6 ft 3 in', weight: '247 lb', college: null },
  { source: 'rolling_insights', sleeperId: '3198', name: 'Derrick Henry', position: 'RB', team: 'Baltimore Ravens', age: 32, yearsExp: null, height: `6'2"`, weight: '252', college: 'Alabama' },
  { source: 'sleeper', sleeperId: '3198', name: 'Derrick Henry', position: 'RB', team: 'BAL', age: 32, yearsExp: 10, height: '75', weight: '252', college: 'Alabama' },
  { source: 'backfill', sleeperId: null, name: 'Derrick Henry', position: 'RB', team: 'Baltimore Ravens' },
]

describe('heightInches / weightPounds', () => {
  it('reads every stored format', () => {
    expect([heightInches('75'), heightInches(`6'2"`), heightInches(`5' 8"`), heightInches('6 ft 3 in'), heightInches('6-2')]).toEqual([75, 74, 68, 75, 74])
    expect([heightInches(''), heightInches('tall'), heightInches('12')]).toEqual([null, null, null])
    expect([weightPounds('252'), weightPounds('211 lbs'), weightPounds('247 lb'), weightPounds(null), weightPounds('9')]).toEqual([252, 211, 247, null, null])
  })
})

describe('mergeCardBio', () => {
  it('takes each field from the most trusted source that has it: Sleeper first', () => {
    expect(mergeCardBio(henry)).toEqual({ age: 32, heightIn: 75, weightLbs: 252, yearsExp: 10, college: 'Alabama' })
  })

  it('fills from the next source when Sleeper has no row, and keeps a rookie\'s 0', () => {
    expect(mergeCardBio(henry.filter((r) => r.source !== 'sleeper'))).toEqual({ age: 32, heightIn: 74, weightLbs: 252, yearsExp: null, college: 'Alabama' })
    expect(mergeCardBio([{ source: 'sleeper', name: 'R', yearsExp: 0 }]).yearsExp).toBe(0)
  })
})

describe('rowsForPlayer', () => {
  it('by name: only that position, and nothing when two different players share the name', () => {
    const smith: CardBioRow[] = [
      { source: 'sleeper', sleeperId: '7525', name: 'DeVonta Smith', position: 'WR' },
      { source: 'sleeper', sleeperId: '9999', name: 'DeVonta Smith', position: 'CB' },
    ]
    expect(rowsForPlayer(smith, { name: 'DeVonta Smith', position: 'WR' }, false).map((r) => r.sleeperId)).toEqual(['7525'])
    expect(rowsForPlayer(smith, { name: 'DeVonta Smith' }, false)).toEqual([])
  })
})

describe('the card', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the stored bio and the latest news', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).startsWith('/api/players/card')
          ? {
              bio: { age: 32, heightIn: 75, weightLbs: 252, yearsExp: 10, college: 'Alabama' },
              news: [{ title: 'Henry tops 1,000 yards again', body: 'Tenth straight season.', source: 'ESPN', publishedAt: null, url: null }],
            }
          : {},
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PlayerDetailModal open onClose={() => {}} player={{ id: '3198', name: 'Derrick Henry', position: 'RB', team: 'BAL', byeWeek: 13, adp: 15.5 }} sport="NFL" canDraft={false} />)
    await waitFor(() => expect(screen.getByText('Alabama')).toBeTruthy())
    expect(screen.getByText('32')).toBeTruthy()
    expect(screen.getByText(`6'3"`)).toBeTruthy()
    expect(screen.getByText('252 lbs')).toBeTruthy()
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.getByText('Henry tops 1,000 yards again')).toBeTruthy()
    const cardCall = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/players/card'))
    expect(cardCall).toContain('playerId=3198')
    expect(cardCall).toContain('sport=NFL')
  })
})

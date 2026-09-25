import { describe, expect, it } from 'vitest'

import { normalizeRIDepthChartPlayers } from '@/lib/rolling-insights'

describe('Rolling Insights depth chart normalization', () => {
  it('skips null and incomplete provider rows without dropping valid players', () => {
    const players = normalizeRIDepthChartPlayers('WR', [
      null,
      undefined,
      {},
      { id: null, player: 'Missing Id' },
      { id: '123', player: '' },
      {
        id: '456',
        player: 'Rome Odunze',
        number: '15',
        status: 'Active',
        img: 'https://cdn.example.test/headshot.png',
      },
      { player_id: 789, name: 'Backup Receiver', position: 'WR2' },
    ])

    expect(players).toEqual([
      {
        id: '456',
        player: 'Rome Odunze',
        position: 'WR',
        number: 15,
        status: 'Active',
        img: 'https://cdn.example.test/headshot.png',
      },
      {
        id: '789',
        player: 'Backup Receiver',
        position: 'WR2',
        number: null,
        status: null,
        img: null,
      },
    ])
  })

  /*
   * RI answers a missing headshot with the literal string `contact_support` (and a bare
   * word or filename is a RELATIVE <img src>, i.e. a 404 on our own origin). Only a real
   * URL survives normalization — see lib/media/imageUrl.ts.
   */
  it('drops image values that are not URLs', () => {
    const players = normalizeRIDepthChartPlayers('WR', [
      { id: '1', player: 'No Headshot', img: 'contact_support' },
      { id: '2', player: 'Bare Filename', img: 'headshot.png' },
    ])
    expect(players.map((p) => p.img)).toEqual([null, null])
  })
})

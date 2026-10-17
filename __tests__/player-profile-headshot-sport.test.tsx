import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { PlayerProfileClient, type PlayerIdentity } from '@/app/player/[playerId]/PlayerProfileClient'

/*
 * The Sleeper thumbnail path is NFL's. Sleeper ids are per-sport, so an NBA or MLB id there is a
 * different person's face — initials are the honest rendering.
 */

vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))
afterEach(cleanup)

function player(over: Partial<PlayerIdentity>): PlayerIdentity {
  return { id: 'p1', name: 'Test Player', position: 'PG', team: 'LAL', sport: 'NBA', sleeperId: '4866', status: 'active', ...over }
}

const sleeperImgs = (c: HTMLElement) => [...c.querySelectorAll('img')].filter((i) => (i.getAttribute('src') ?? '').includes('sleepercdn.com'))

describe('the player profile headshot', () => {
  it('does not put an NBA id on the NFL thumbnail path', () => {
    const { container } = render(<PlayerProfileClient player={player({ sport: 'NBA' })} />)
    expect(sleeperImgs(container)).toHaveLength(0)
  })

  it('still uses it for an NFL player', () => {
    const { container } = render(<PlayerProfileClient player={player({ sport: 'NFL', position: 'QB', team: 'KC' })} />)
    expect(sleeperImgs(container).map((i) => i.getAttribute('src'))).toEqual([
      'https://sleepercdn.com/content/nfl/players/thumb/4866.jpg',
    ])
  })
})

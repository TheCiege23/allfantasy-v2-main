/** The one-off backfill plans the same status the live lifecycle writes carry, and nothing else. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { planNativeStatusBackfill } from '../../scripts/backfill-native-league-status'

const row = (id: string, status: string | null, lifecycleState: string) => ({ id, name: id, status, lifecycleState })

describe('planNativeStatusBackfill', () => {
  it('moves a league that is past setup, and leaves one that already agrees', () => {
    expect(
      planNativeStatusBackfill([
        row('mid-season', 'setup', 'in_season'),
        row('drafted', 'setup', 'post_draft'),
        row('playoffs', 'setup', 'playoffs'),
        row('over', 'setup', 'offseason'),
        row('no-status', null, 'drafting'),
        row('still-setup', 'setup', 'setup'),
        row('already-right', 'in_season', 'in_season'),
      ]).map((c) => [c.id, c.next]),
    ).toEqual([
      ['mid-season', 'in_season'],
      ['drafted', 'in_season'],
      ['playoffs', 'in_season'],
      ['over', 'complete'],
      ['no-status', 'drafting'],
    ])
  })
  it('🛑 never touches an archived league or a state it does not know', () => {
    expect(planNativeStatusBackfill([row('archived', 'setup', 'archived'), row('odd', 'setup', 'CURRENT')])).toEqual([])
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { adviceForValueMove } from '@/lib/core-app/crossLeagueValueActions'

describe('cross-league value action copy', () => {
  it('states how many owned rosters a rise affects', () => {
    expect(adviceForValueMove('up', 3)).toContain('3 of your rosters')
    expect(adviceForValueMove('up', 3)).toContain('sell-high')
  })

  it('keeps a one-league fall scoped to this roster', () => {
    expect(adviceForValueMove('down', 1)).toContain('this roster')
    expect(adviceForValueMove('down', 1)).toContain('buy-low')
  })
})

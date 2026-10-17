// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/core' }))

import { badgeCount } from '@/components/core-app/comms/CommsDock'

describe('launcher badge count', () => {
  it('is exact up to 99, then "99+" so it never overflows the 56px bubble', () => {
    expect(badgeCount(1)).toBe('1')
    expect(badgeCount(99)).toBe('99')
    expect(badgeCount(100)).toBe('99+')
    expect(badgeCount(1432)).toBe('99+')
  })
})

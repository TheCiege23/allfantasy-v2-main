import { describe, expect, it } from 'vitest'
import { PRIMARY_NAV_ITEMS, getPrimaryNavItems } from '@/lib/navigation/NavLinkResolver'

// Phase 36: real finding (Phase 35) -- /manager-hub was real and fully wired end-to-end but
// had zero entry point in primary navigation, unlike /commissioner-hub which already had one.
// This adds the same top-level placement Commissioner Hub already has, per the established
// precedent -- no new navigation pattern invented.
describe('PRIMARY_NAV_ITEMS — Manager Hub entry (Phase 36)', () => {
  it('includes a /manager-hub entry', () => {
    const entry = PRIMARY_NAV_ITEMS.find((i) => i.href === '/manager-hub')
    expect(entry).toBeDefined()
    expect(entry?.label).toBe('Manager Hub')
  })

  it('is present for both admin and non-admin nav resolution', () => {
    expect(getPrimaryNavItems(false).some((i) => i.href === '/manager-hub')).toBe(true)
    expect(getPrimaryNavItems(true).some((i) => i.href === '/manager-hub')).toBe(true)
  })

  it('does not duplicate or remove any existing nav item', () => {
    const hrefs = PRIMARY_NAV_ITEMS.map((i) => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    for (const existing of ['/dashboard', '/commissioner-hub', '/war-room', '/discover/leagues', '/ai/tools', '/af-rankings', '/profile', '/messages', '/wallet', '/settings']) {
      expect(hrefs).toContain(existing)
    }
  })
})

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Devy menu entries belong to devy and campus-to-canton leagues only (user report, 2026-09-16:
 * "why is devy showing in the league dashboard for every league?").
 *
 * The hub entry was ungated by design — "cross-league and always available" — so a redraft
 * league's menu offered Devy. These pin both halves: the shell shows the entry only when told the
 * scope is devy, and `leagueDevyNav` says so for every signal the codebase uses and for nothing else.
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))
const db = vi.hoisted(() => ({
  devy: null as null | { devySlotCount: number },
  c2c: null as null | { id: string },
  fail: false,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))
vi.mock('@/lib/prisma', () => {
  const answer = <T,>(value: () => T) =>
    vi.fn(async () => {
      if (db.fail) throw new Error('db down')
      return value()
    })
  return {
    prisma: {
      devyLeagueConfig: { findUnique: answer(() => db.devy) },
      c2CLeagueConfig: { findUnique: answer(() => db.c2c) },
    },
  }
})

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { leagueDevyNav, looksLikeDevyFormat } from '@/lib/core-app/devy'

const LEAGUES = [{ id: 'l1', name: 'Dynasty Warriors', platform: 'sleeper', mark: 'DW' }]

function navLabels(props: Record<string, unknown>): string[] {
  const { container } = render(
    <AfCoreShell
      active="home"
      leagues={LEAGUES as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      {...props}
    >
      <div>screen</div>
    </AfCoreShell>,
  )
  return Array.from(container.querySelectorAll('a[href^="/core/devy"]')).map((a) => a.getAttribute('href') ?? '')
}

beforeEach(() => {
  db.devy = null
  db.c2c = null
  db.fail = false
})

describe('the shell', () => {
  it('🛑 offers no Devy entry for a league that is not devy or C2C', () => {
    expect(navLabels({ selectedLeagueId: 'l1', devyInScope: false })).toEqual([])
    // …and none when the page says nothing at all.
    expect(navLabels({ selectedLeagueId: 'l1' })).toEqual([])
  })

  it('offers the hub for a devy or C2C league, and the league tab only with devy slots', () => {
    expect(navLabels({ selectedLeagueId: 'l1', devyInScope: true })).toEqual(['/core/devy?league=l1'])
    expect(navLabels({ selectedLeagueId: 'l1', devyInScope: true, devySlotCount: 3 })).toEqual([
      '/core/devy?league=l1',
      '/core/devy-league?league=l1',
    ])
  })

  it('offers the hub with no league held only when the page says the user plays devy', () => {
    expect(navLabels({ devyInScope: true })).toEqual(['/core/devy'])
    expect(navLabels({ devyInScope: false })).toEqual([])
  })
})

describe('looksLikeDevyFormat', () => {
  it('is true for the devy and C2C variants and types, in any case', () => {
    expect(looksLikeDevyFormat({ leagueVariant: 'devy_dynasty' })).toBe(true)
    expect(looksLikeDevyFormat({ leagueVariant: 'merged_devy_c2c' })).toBe(true)
    expect(looksLikeDevyFormat({ leagueType: 'Devy' })).toBe(true)
    expect(looksLikeDevyFormat({ leagueType: ' c2c ' })).toBe(true)
  })

  it('is false for everything else', () => {
    for (const league of [
      {},
      { leagueVariant: null, leagueType: null },
      { leagueType: 'dynasty' },
      { leagueType: 'redraft' },
      { leagueVariant: 'big_brother' },
      { leagueType: 'devy_adjacent' },
    ]) {
      expect(looksLikeDevyFormat(league)).toBe(false)
    }
  })
})

describe('leagueDevyNav', () => {
  const row = (fields: Record<string, unknown>) => Promise.resolve(fields)

  it('a DevyLeagueConfig row makes it devy, even with zero slots', async () => {
    db.devy = { devySlotCount: 0 }
    await expect(leagueDevyNav('L', row({ leagueType: 'dynasty' }))).resolves.toEqual({
      devySlotCount: 0,
      devyFormat: true,
    })
    db.devy = { devySlotCount: 4 }
    await expect(leagueDevyNav('L', row({}))).resolves.toEqual({ devySlotCount: 4, devyFormat: true })
  })

  it('🛑 a C2C league is devy too, though it has no DevyLeagueConfig', async () => {
    db.c2c = { id: 'c' }
    await expect(leagueDevyNav('L', row({ leagueType: 'dynasty' }))).resolves.toEqual({
      devySlotCount: 0,
      devyFormat: true,
    })
  })

  it('reads the variant and the league type off the shared row', async () => {
    await expect(leagueDevyNav('L', row({ leagueVariant: 'merged_devy_c2c' }))).resolves.toMatchObject({ devyFormat: true })
    await expect(leagueDevyNav('L', row({ leagueType: 'devy' }))).resolves.toMatchObject({ devyFormat: true })
  })

  it('prefers a commissioner-confirmed type over the stored one', async () => {
    const confirmedC2c = { leagueType: 'dynasty', settings: { leagueTypeConfirmation: { type: 'c2c' } } }
    await expect(leagueDevyNav('L', row(confirmedC2c))).resolves.toMatchObject({ devyFormat: true })
    const confirmedRedraft = { leagueType: 'devy', settings: { leagueTypeConfirmation: { type: 'redraft' } } }
    await expect(leagueDevyNav('L', row(confirmedRedraft))).resolves.toMatchObject({ devyFormat: false })
  })

  it('🛑 a redraft or plain dynasty league is not devy', async () => {
    await expect(leagueDevyNav('L', row({ leagueType: 'redraft' }))).resolves.toEqual({
      devySlotCount: 0,
      devyFormat: false,
    })
    await expect(leagueDevyNav('L', row({ leagueType: 'dynasty', leagueVariant: null }))).resolves.toMatchObject({
      devyFormat: false,
    })
  })

  it('degrades to "not devy" when the reads fail, rather than throwing', async () => {
    db.fail = true
    await expect(leagueDevyNav('L', Promise.reject(new Error('row failed')))).resolves.toEqual({
      devySlotCount: 0,
      devyFormat: false,
    })
  })
})

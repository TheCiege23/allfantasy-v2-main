/**
 * Imported leagues open in the same workspace as native ones (2026-11-22). An imported league has no League home
 * tab, so its first page (Decide: What's next, record, standing, standings) is its Overview under League, and it is
 * not listed a second time as Trade's Decision OS. A native league keeps its own Overview and Decision OS.
 */
import { describe, expect, it } from 'vitest'
import { buildNativeLeagueNavigation, nativeNavTabFor } from '@/lib/league/nativeLeagueNavigation'

const ids = (...list: string[]) => list.map((id) => ({ id, label: id }))

describe('workspace navigation for an imported league', () => {
  const imported = ids('decide', 'draft_intel', 'roster', 'matchups', 'standings', 'trades', 'settings', 'legacy', 'activity', 'news')
  const groups = buildNativeLeagueNavigation(imported, false, false, undefined, { draftDone: true })
  const top = groups[0].items

  it('Decide is League › Overview', () => {
    const league = nativeNavTabFor(groups, 'decide')
    expect(league?.label).toBe('League')
    expect(league?.children[0]).toMatchObject({ id: 'decide', label: 'Overview' })
  })

  it('Decide is not also a Trade sub-tab', () => {
    const trade = top.find((item) => item.label === 'Trade')
    expect(trade?.children.map((child) => child.id)).toEqual(['trades'])
    expect(groups.flatMap((g) => g.items.flatMap((i) => i.children)).filter((c) => c.id === 'decide')).toHaveLength(1)
  })
})

describe('workspace navigation for a native league is unchanged', () => {
  it('keeps League home as Overview and Decision OS under Trade', () => {
    const native = ids('native_home', 'decide', 'roster', 'matchups', 'standings', 'trades', 'settings')
    const groups = buildNativeLeagueNavigation(native, false, false, undefined, { draftDone: true })
    expect(nativeNavTabFor(groups, 'native_home')?.children[0]).toMatchObject({ id: 'native_home', label: 'Overview' })
    const trade = nativeNavTabFor(groups, 'decide')
    expect(trade?.label).toBe('Trade')
    expect(trade?.children.find((c) => c.id === 'decide')?.label).toBe('Decision OS')
  })
})

/**
 * Big Brother sidebar (2026-11-07, Big Brother audit item 4). Built from the tab list a Big Brother league really gets
 * (LeagueTabs + the matchup transition + the Big Brother block), the nav showed:
 *   - thirteen "More tools" items on the generic "?" icon, the first labelled "👁 Big Brother"
 *   - "Matchup" twice (`matchups` and `matchup` render the same screen) and "Commissioner" twice; on the phone's
 *     Section picker "Players" read as a duplicate of "Players & waivers" too
 * The duplicates and the "?" icons are not Big Brother's alone — any league with those tab ids had them — so the
 * dedupe and the secondary-tool icons are asserted on a plain redraft list as well.
 */
import { describe, expect, it } from 'vitest'
import { buildNativeLeagueNavigation } from '@/lib/league/nativeLeagueNavigation'
import { getLeagueTabsForViewer } from '@/app/league/[leagueId]/LeagueTabs'
import { applyMatchupPrimaryTab } from '@/lib/matchup-center/tabTransition'
import { translations } from '@/lib/i18n/translations'

const BB_BLOCK = [
  { id: 'big_brother', label: '👁 Big Brother' },
  { id: 'bb_hoh', label: 'HOH' },
  { id: 'bb_veto', label: 'Veto' },
  { id: 'bb_voting', label: 'Voting' },
  { id: 'bb_jury', label: 'Jury' },
  { id: 'bb_twists', label: 'Twists' },
  { id: 'bb_history', label: 'History' },
  { id: 'bb_command', label: 'Command' },
]

/** The workspace's tab list, as LeagueShell / the harness assemble it. */
function workspaceTabs(extra: { id: string; label: string }[]) {
  const base = getLeagueTabsForViewer('NFL', true)
  const withBlock = [...base, ...extra, { id: 'settings', label: 'Settings' }]
  return [
    { id: 'native_home', label: 'League home' },
    { id: 'decide', label: 'Decide' },
    { id: 'draft_intel', label: 'Live Intel' },
    ...applyMatchupPrimaryTab(withBlock, true),
    { id: 'legacy', label: 'Legacy' },
  ]
}
const flat = (groups: ReturnType<typeof buildNativeLeagueNavigation>) => groups.flatMap(g => g.items)
const tEs = (key: string) => (translations as Record<string, Record<string, string>>).es?.[key] ?? translations.en[key] ?? key

describe('Big Brother sidebar', () => {
  const groups = buildNativeLeagueNavigation(workspaceTabs(BB_BLOCK), true)

  it('gets its own group, in the in-page view names, each with a real icon', () => {
    const bb = groups.find(g => g.id === 'bigbrother')
    expect(bb?.title).toBe('Big Brother')
    expect(bb?.items.map(i => i.label)).toEqual(['House', 'HOH', 'Veto', 'Voting', 'Jury', 'Twists', 'History', 'Command'])
    expect(bb?.items.every(i => i.icon !== 'more')).toBe(true)
    expect(new Set(bb?.items.map(i => i.icon)).size).toBe(8)
    expect(flat(groups).some(i => /👁/.test(i.label))).toBe(false)
  })

  it('no label appears twice anywhere in the nav (the phone Section picker lists them all in one menu)', () => {
    const labels = flat(groups).map(i => i.label.toLowerCase())
    expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([])
  })

  it('nothing in More tools is left on the "?" icon', () => {
    const more = groups.find(g => g.id === 'more')
    expect(more?.items.filter(i => i.icon === 'more').map(i => i.id)).toEqual([])
  })
})

describe('the dedupe and icons are general, not Big Brother only', () => {
  const groups = buildNativeLeagueNavigation(workspaceTabs([]), true)
  const ids = flat(groups).map(i => i.id)

  it('matchups/matchup render one screen, so only one is listed', () => {
    expect(ids.filter(id => id === 'matchups' || id === 'matchup')).toHaveLength(1)
  })

  it('players and commissioner stay reachable, under names of their own', () => {
    const byId = Object.fromEntries(flat(groups).map(i => [i.id, i]))
    expect(byId.players?.label).toBe('Player search')
    expect(byId.commissioner?.label).toBe('Commissioner tools')
    expect(byId.settings?.label).toBe('Commissioner')
    expect(byId.waivers?.label).toBe('Players & waivers')
  })

  it('a member does not see commissioner tools at all (unchanged)', () => {
    const member = flat(buildNativeLeagueNavigation(workspaceTabs([]), false)).map(i => i.id)
    expect(member).not.toContain('commissioner')
    expect(member).not.toContain('settings')
  })

  it('Spanish has the new labels', () => {
    const es = buildNativeLeagueNavigation(workspaceTabs(BB_BLOCK), true, false, tEs)
    expect(es.find(g => g.id === 'bigbrother')?.items.map(i => i.label)).toEqual(['Casa', 'HOH', 'Veto', 'Votación', 'Jurado', 'Giros', 'Historial', 'Mando'])
    expect(flat(es).find(i => i.id === 'players')?.label).toBe('Buscar jugadores')
  })
})

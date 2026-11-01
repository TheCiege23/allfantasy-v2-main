import { describe, expect, it } from 'vitest'
import { buildNativeLeagueNavigation, nativeLeagueRecordLinks, nativeLeagueRecordTitle } from '@/lib/league/nativeLeagueNavigation'
import { localizeLeagueTabs } from '@/app/league/[leagueId]/LeagueTabs'
import { translations } from '@/lib/i18n/translations'

const base = [
  { id: 'native_home', label: 'League home' },
  { id: 'roster', label: 'My Team' },
  { id: 'matchups', label: 'Matchups' },
  { id: 'waivers', label: 'Waivers' },
  { id: 'trades', label: 'Trades' },
  { id: 'draft', label: 'Draft' },
  { id: 'standings', label: 'Standings' },
  { id: 'league_chat', label: 'League Chat' },
  { id: 'war_room', label: 'War Room' },
  { id: 'decide', label: 'Decide' },
  { id: 'legacy', label: 'Legacy' },
]
const dynastyTabs = [
  { id: 'dynasty', label: 'Dynasty' },
  { id: 'dynasty_taxi', label: 'Taxi' },
  { id: 'dynasty_picks', label: 'Picks' },
]
const tFor = (lang: 'en' | 'es') => (key: string) => translations[lang]?.[key] ?? translations.en[key] ?? key

describe('native league navigation: Dynasty group', () => {
  it('a dynasty league gets its own Dynasty group with proper icons, not "More tools"', () => {
    const groups = buildNativeLeagueNavigation([...base, ...dynastyTabs], false)
    const dynasty = groups.find(group => group.id === 'dynasty')
    expect(dynasty?.title).toBe('Dynasty')
    expect(dynasty?.items.map(item => [item.id, item.icon])).toEqual([['dynasty', 'dynasty'], ['dynasty_taxi', 'taxi'], ['dynasty_picks', 'picks']])
    const more = groups.find(group => group.id === 'more')
    expect(more?.items.some(item => item.id.startsWith('dynasty'))).toBe(false)
    // It sits right after "This league".
    expect(groups.map(group => group.id).slice(0, 2)).toEqual(['league', 'dynasty'])
  })

  it('a non-dynasty league has no Dynasty group, and its nav is unchanged', () => {
    const groups = buildNativeLeagueNavigation(base, false)
    expect(groups.map(group => group.id)).toEqual(['league', 'week', 'more'])
    expect(groups.map(group => group.title)).toEqual(['This league', 'This week', 'More tools'])
    expect(groups[0].items.map(item => item.label)).toEqual(['League home', 'My team', 'Matchup', 'Players & waivers', 'Trades', 'Draft HQ', 'Standings & playoffs', 'League chat'])
    expect(groups[2].items).toEqual([{ id: 'legacy', label: 'Legacy', icon: 'more' }])
  })

  it('labels and titles go through i18n: Spanish', () => {
    const groups = buildNativeLeagueNavigation([...base, ...dynastyTabs], true, false, tFor('es'))
    expect(groups.map(group => group.title)).toEqual(['Esta liga', 'Dinastía', 'Esta semana', 'Más herramientas'])
    expect(groups[1].items.map(item => item.label)).toEqual(['Centro de dinastía', 'Plantel taxi', 'Picks del draft'])
    const labels = groups.flatMap(group => [group.title, ...group.items.map(item => item.label)])
    expect(labels.join(' ').toLowerCase()).not.toContain('waiver')
    expect(nativeLeagueRecordTitle(tFor('es'))).toBe('Tu historial')
    expect(nativeLeagueRecordLinks('L1', tFor('es')).map(link => link.label)).toEqual(['Tu carrera', 'Rankings'])
  })

  it('English through t matches the built-in fallback exactly', () => {
    const plain = buildNativeLeagueNavigation([...base, ...dynastyTabs], true)
    const viaT = buildNativeLeagueNavigation([...base, ...dynastyTabs], true, false, tFor('en'))
    expect(viaT).toEqual(plain)
  })

  it('an unknown key falls back to English instead of showing the raw key', () => {
    const groups = buildNativeLeagueNavigation(base, false, false, key => key)
    expect(groups[0].title).toBe('This league')
  })

  it('survivor labels are localized too', () => {
    const groups = buildNativeLeagueNavigation([...base, { id: 'survivor', label: '🏝 Island' }, { id: 'survivor_exile', label: 'Exile' }], false, true, tFor('es'))
    expect(groups.find(group => group.id === 'survivor')?.items.map(item => item.label)).toEqual(['Isla', 'Exilio'])
  })
})

describe('dynasty tab labels are localized', () => {
  it('Dynasty / Taxi / Picks have league.tab.* keys in English and Spanish', () => {
    expect(localizeLeagueTabs(dynastyTabs, tFor('es')).map(tab => tab.label)).toEqual(['Dinastía', 'Taxi', 'Picks'])
    expect(localizeLeagueTabs(dynastyTabs, tFor('en')).map(tab => tab.label)).toEqual(['Dynasty', 'Taxi', 'Picks'])
    // Each tab asks for its own key (Taxi and Picks read the same in both languages, so check the keys).
    expect(localizeLeagueTabs(dynastyTabs, key => `[${key}]`).map(tab => tab.label)).toEqual(['[league.tab.dynasty]', '[league.tab.dynastyTaxi]', '[league.tab.dynastyPicks]'])
    for (const key of ['league.tab.dynasty', 'league.tab.dynastyTaxi', 'league.tab.dynastyPicks']) {
      expect(translations.en[key], key).toBeTruthy()
      expect(translations.es[key], key).toBeTruthy()
    }
  })
})

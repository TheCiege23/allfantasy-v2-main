/**
 * The Commissioner Hub's reference sections in Spanish (2026-10-05): league areas, the step-by-step
 * guides, connections, format cards and trade/draft history labels.
 *
 * Same contract as `commissioner-hub-builders-es.test.ts`: each builder takes the reader's language
 * (default English), the English is pinned to a snapshot written from the builders BEFORE they took
 * one, and every Spanish output — after the screen's own `hubCopy` pass, which words the shared
 * hand-off buttons and authority reasons — differs from its English and carries no English word.
 */
import { describe, expect, it } from 'vitest'
import { buildCommunities, buildLeagueAreas, buildWorkflows, type HubLeague, type HubLink } from '@/lib/core-app/commissioner/areas'
import { commissionerFormatCards } from '@/lib/core-app/commissioner/formatCards'
import { importedTradeLabel } from '@/lib/core-app/commissioner/history'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'
import { untranslatedLiterals } from './helpers/untranslatedLiterals'

type Lang = 'en' | 'es'

const native: HubLeague = { id: 'L1', name: 'Xolo League', platform: 'manual', native: true }
const imported: HubLeague = { id: 'L2', name: 'Zibba League', platform: 'sleeper', platformLeagueId: '987654321', season: 2026, native: false }
const unverified: HubLeague = { id: 'L3', name: 'Quorra League', platform: 'espn', native: false }

const link = (l: HubLink | null) => (l ? [l.label] : [])

function collect(language: Lang): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [name, league] of [['native', native], ['imported', imported], ['unverified', unverified]] as const) {
    out[`areas/${name}`] = buildLeagueAreas(league, language).flatMap((a) => [a.label, a.description, ...(a.note ? [a.note] : []), ...link(a.link), ...link(a.changeOn)])
    out[`guides/${name}`] = buildWorkflows(league, language).flatMap((w) => [
      w.title, w.summary, ...(w.authorityNote ? [w.authorityNote] : []),
      ...w.steps.flatMap((s) => [s.title, s.body, ...link(s.link)]),
    ])
  }
  const community = (over: Partial<Parameters<typeof buildCommunities>[0]>) =>
    buildCommunities({
      league: native, viewerIsOwner: true, viewerCanBroadcast: true, discord: null, datedEventCount: 3,
      payment: { link: null, provider: null, tracked: true }, claimedTeams: 8, totalTeams: 10, language, ...over,
    }).flatMap((c) => [c.label, c.detail, ...link(c.link)])
  out['connections/native'] = community({})
  out['connections/discord-on'] = community({ discord: { guildName: 'Vexa Guild', channelName: 'wuzzo' }, datedEventCount: 1 })
  out['connections/discord-on-bare'] = community({ discord: { guildName: null, channelName: null } })
  out['connections/not-owner'] = community({ viewerIsOwner: false, viewerCanBroadcast: false, claimedTeams: 0, datedEventCount: 0, payment: { link: null, provider: null, tracked: false } })
  out['connections/paid-link'] = community({ payment: { link: 'https://x.test/pay', provider: 'leaguesafe', tracked: true } })
  out['connections/paid-link-other'] = community({ payment: { link: 'https://x.test/pay', provider: 'venmo', tracked: true } })
  out['connections/imported'] = community({ league: imported })
  out['connections/unverified'] = community({ league: unverified })

  const profile = (over: Record<string, unknown>) =>
    ({ leagueId: 'L1', capabilityIds: [], canonicalFormatId: null, conceptId: null, aliasTags: [], ...over }) as never
  out['format/capabilities'] = commissionerFormatCards(
    profile({ capabilityIds: ['roster.keeper_carryover', 'elimination.guillotine', 'survivor.tribes', 'standings.promotion_relegation', 'advancement.tournament'] }),
    null, language,
  ).flatMap((c) => [c.title, c.detail, c.action])
  for (const id of ['big_brother', 'zombie', 'devy', 'c2c']) {
    out[`format/${id}`] = commissionerFormatCards(profile({ canonicalFormatId: id }), null, language).flatMap((c) => [c.title, c.detail, c.action])
  }
  out['format/four_horsemen'] = commissionerFormatCards(profile({}), 'four_horsemen', language).flatMap((c) => [c.title, c.detail, c.action])

  const trade = (over: Record<string, unknown>) =>
    importedTradeLabel({ involvedTeams: [], managerName: null, adds: [], picks: [], ...over } as never, language)
  out['trade-label'] = [
    trade({}),
    trade({ involvedTeams: ['Xolo', 'Zibba'], adds: [{ name: 'Kplex Q' }], picks: ['2027 R1'] }),
    trade({ involvedTeams: ['Xolo', 'Zibba'], adds: Array.from({ length: 8 }, (_, i) => ({ name: `P${i}` })) }),
  ]
  return out
}

const PASS = /\b(AllFantasy|Sleeper|ESPN|Discord|LeagueSafe|FanCred|Google|Apple|Outlook|Draft HQ|Drafts|FAAB|HOH|Big Brother|Survivor|Campus to Canton|Four Horsemen|Xolo|Zibba|Quorra|Vexa|Wuzzo|Kplex Q|Kplex|Guild|wuzzo)\b/g
// "chat" and "Drafts" are absent from the English list on purpose: the app's Spanish uses both as
// loanwords ("el chat de la liga", Drafts), as it does "draft".
const ENGLISH = /\b(the|and|or|has|have|with|of|is|are|be|to|for|on|in|from|by|this|that|every|who|what|open|see|make|change|set|post|tell|find|check|get|review|confirm|invite|announce|league|team|teams|manager|managers|rule|rules|trade|trades|vote|poll|date|time|settings|standings|schedule|history|members|overview|waivers|claims|dues|payment|link|calendar|connected|managers|unattributed|more)\b/i

describe('commissioner hub reference sections', () => {
  it('🛑 the English is byte-identical to what the builders wrote before they took a language', () => {
    expect(collect('en')).toMatchSnapshot()
  })

  it('🛑 every Spanish output, after the screen’s hubCopy pass, differs from its English and carries no English word', () => {
    const en = collect('en')
    const es = collect('es')
    const problems: string[] = []
    for (const [k, list] of Object.entries(es)) {
      expect(list.length, k).toBe(en[k]?.length)
      list.forEach((raw, i) => {
        // An empty or missing sentence is a bug of its own — `L(english)` with no Spanish yields undefined.
        if (typeof raw !== 'string' || raw.trim() === '') {
          problems.push(`${k}[${i}] empty: ${JSON.stringify(raw)} (English: ${en[k]?.[i]})`)
          return
        }
        const s = hubCopy(raw, 'es') // what the screen renders
        const own = s.replace(PASS, '').replace(/\b(P\d|R\d|\d+)\b/g, '').trim()
        if (/^[\s:,.↔+·—]*$/.test(own)) return // nothing but names, brands and numbers
        if (s === en[k]?.[i]) problems.push(`${k}[${i}] unchanged: ${s}`)
        else if (ENGLISH.test(own)) problems.push(`${k}[${i}] English left: ${s}`)
      })
    }
    expect(problems).toEqual([])
  })

  it('🛑 no English sentence in these files lacks its Spanish branch', () => {
    expect(
      ['lib/core-app/commissioner/areas.ts', 'lib/core-app/commissioner/formatCards.ts', 'lib/core-app/commissioner/history.ts'].flatMap((f) =>
        untranslatedLiterals(f),
      ),
    ).toEqual([])
  })
})

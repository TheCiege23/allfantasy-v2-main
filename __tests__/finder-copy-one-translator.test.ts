/**
 * One translator per label (2026-10-06). The three Player Finder Spanish groups (#2069, #2070, #2071)
 * each wrote some of the same labels; the duplicates now resolve to ONE definition, and every former
 * caller is run here through the survivor with the inputs it uses, against the exact string it
 * printed before the merge — English and Spanish both. A survivor that drifted from any one of its
 * former callers fails here, by name.
 *
 *   "Claim X in Y"        finderSearchCopy `claimText` ← faCopy.claim, finderPlayerInfoCopy dcClaim, viewActionsText
 *   "Taken"               finderSearchCopy `takenText` ← the strip's badge, finderPlayerInfoCopy dcTaken
 *   "Free agent"          finderSearchCopy `freeAgentText` ← viewActionsText's status, finderTradeValueCopy freeAgent
 *   "Open Trade Center"   finderPlayerInfoCopy wsOpenTradeCenter ← finderTradeValueCopy openTradeCenter
 *   "Proj"                playerFinderCopy colProj ← finderPlayerInfoCopy colProj
 *   "Wk", "projected"     coreUiCopy ← finderPlayerInfoCopy colWeek, projected (Spanish was a copy of it)
 *   "Nothing", "Another manager"  coreUiCopy ← finderTradeValueCopy nothing, anotherManager
 */
import { describe, expect, it } from 'vitest'

import { claimText, faCopy, freeAgentText, stripChipText, takenText, viewActionsText } from '@/lib/core-app/finderSearchCopy'
import { finderPlayerInfoCopy } from '@/lib/core-app/finderPlayerInfoCopy'
import { tradeValueCopy } from '@/lib/core-app/finderTradeValueCopy'
import { finderCopy } from '@/lib/core-app/playerFinderCopy'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import type { LeagueViewActions } from '@/lib/core-app/leagueViewActions'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'
import type { StripChip } from '@/lib/core-app/leagueStrip'

/** The names and platforms the callers pass: a plain surname, an initialled one, one with a suffix. */
const CLAIMS: Array<[string, string]> = [
  ['Kincaid', 'Sleeper'],
  ['Amon-Ra', 'ESPN'],
  ['Jr.', 'Yahoo'],
  ['Likely', 'AllFantasy'],
]

describe('"Claim X in Y" — one translator', () => {
  it('the FA bids row (faCopy.claim, #2070) prints what it printed before', () => {
    for (const [last, platform] of CLAIMS) {
      expect(faCopy('en').claim(last, platform)).toBe(`Claim ${last} in ${platform}`)
      expect(faCopy('es').claim(last, platform)).toBe(`Reclamar a ${last} en ${platform}`)
    }
  })

  it('the depth chart’s free backup (dcClaim, #2069) prints what it printed before', () => {
    for (const [last, platform] of CLAIMS) {
      expect(finderPlayerInfoCopy('en').dcClaim(last, platform)).toBe(`Claim ${last} in ${platform}`)
      expect(finderPlayerInfoCopy('es').dcClaim(last, platform)).toBe(`Reclamar a ${last} en ${platform}`)
    }
  })

  it('the league card and the sticky bar (viewActionsText, #2070/#2071) print what they printed before', () => {
    const view = { ownership: { kind: 'free-agent' } } as unknown as PlayerLeagueView
    for (const [last, platform] of CLAIMS) {
      const actions: LeagueViewActions = {
        primary: { label: `Claim ${last} — on ${platform}`, href: 'https://x', external: true, internal: false },
        secondary: null,
        status: 'Free agent',
      }
      const name = `Dalton ${last}`
      expect(viewActionsText(view, actions, name, 'en')).toBe(actions)
      const es = viewActionsText(view, actions, name, 'es')
      expect(es.primary?.label).toBe(`Reclamar a ${last} en ${platform}`)
      expect(es.status).toBe('Agente libre')
      expect(es.primary?.href).toBe('https://x')
    }
  })

  it('and all three are the survivor', () => {
    for (const [last, platform] of CLAIMS) {
      for (const lang of ['en', 'es'] as const) {
        expect(faCopy(lang).claim(last, platform)).toBe(claimText(last, platform, lang))
        expect(finderPlayerInfoCopy(lang).dcClaim(last, platform)).toBe(claimText(last, platform, lang))
      }
    }
  })
})

describe('the other shared labels — each former caller, its old string, the survivor', () => {
  it('"Taken": the strip’s badge and the depth chart’s chip', () => {
    const chip = { state: 'other', team: null, leagueName: 'Liga Norte', last: 'Cook', badge: 'Taken', sentence: 'x' } as unknown as StripChip
    expect(stripChipText(chip, 'en').badge).toBe('Taken')
    expect(stripChipText(chip, 'es').badge).toBe('Ocupado')
    expect(finderPlayerInfoCopy('en').dcTaken).toBe('Taken')
    expect(finderPlayerInfoCopy('es').dcTaken).toBe('Ocupado')
    for (const lang of ['en', 'es'] as const) expect(finderPlayerInfoCopy(lang).dcTaken).toBe(takenText(lang))
  })

  it('"Free agent": the shares board’s holder', () => {
    expect(tradeValueCopy('en').freeAgent).toBe('Free agent')
    expect(tradeValueCopy('es').freeAgent).toBe('Agente libre')
    for (const lang of ['en', 'es'] as const) expect(tradeValueCopy(lang).freeAgent).toBe(freeAgentText(lang))
  })

  it('"Open Trade Center": the trade visual’s button and Who’d start him’s link', () => {
    for (const [lang, want] of [['en', 'Open Trade Center'], ['es', 'Abrir Centro de intercambios']] as const) {
      expect(tradeValueCopy(lang).openTradeCenter).toBe(want)
      expect(finderPlayerInfoCopy(lang).wsOpenTradeCenter).toBe(want)
    }
  })

  it('"Proj", "Wk" and "projected": the season card’s column heads and legend', () => {
    expect(finderPlayerInfoCopy('en').colProj).toBe('Proj')
    expect(finderPlayerInfoCopy('es').colProj).toBe('Proy.')
    expect(finderPlayerInfoCopy('es').colProj).toBe(finderCopy('es').colProj)
    expect(finderPlayerInfoCopy('en').colWeek).toBe('Wk')
    expect(finderPlayerInfoCopy('es').colWeek).toBe('Sem.')
    expect(finderPlayerInfoCopy('es').colWeek).toBe(coreUiCopy('Wk', 'es'))
    expect(finderPlayerInfoCopy('en').projected).toBe('projected')
    expect(finderPlayerInfoCopy('es').projected).toBe('proyectado')
    expect(finderPlayerInfoCopy('es').projected).toBe(coreUiCopy('projected', 'es'))
  })

  it('"Nothing" and "Another manager": the trade visual and the shares board', () => {
    expect(tradeValueCopy('en').nothing).toBe('Nothing')
    expect(tradeValueCopy('es').nothing).toBe('Nada')
    expect(tradeValueCopy('es').nothing).toBe(coreUiCopy('Nothing', 'es'))
    expect(tradeValueCopy('en').anotherManager).toBe('Another manager')
    expect(tradeValueCopy('es').anotherManager).toBe('Otro mánager')
    expect(tradeValueCopy('es').anotherManager).toBe(coreUiCopy('Another manager', 'es'))
  })
})

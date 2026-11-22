import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/*
 * Trades and Moves, one tab (2026-11-14).
 *
 * - Moves is gone from the rail, the tab row and the destinations list; /core/moves redirects to Trades.
 * - What Moves had that Trades did not — the adds, drops and claims — is "League activity" under the
 *   trade history. Trades are not repeated there.
 * - The builder is "Create a trade", with the screenshot upload in view rather than two folds down.
 * - Inside a league: no Switch league fold, no "What real trades say", no league-name row, and the
 *   Rebuild plan starts folded.
 * - A traded pick is its own chip ("2027 1st  2,698"), not ", 2027 round 12,698".
 * - "Priced 8724% higher in dynasty" is not printed; past 300% the sentence carries no number.
 */

import { activityRows, activityText, type ActivityRow } from '@/lib/core-app/tradesActivity'
import { shortPickLabel, tradesActivityMessages } from '@/lib/core-app/messages/tradesActivity'
import { TradesLeagueActivityView } from '@/components/core-app/screens/TradesLeagueActivityView'
import { MAX_SHOWN_PCT, pct } from '@/lib/trade-intel/rebuildAdvisor'
import { NAV_SECTION_ORDER } from '@/lib/core-app/leagueDestinations'
import type { LeagueActivityItem } from '@/lib/core-app/leagueActivity'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
/** Code lines only: a statement starts its line, a comment line starts with `*` or `//`. */
const code = (p: string) =>
  src(p)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(l))
    .join('\n')

afterEach(cleanup)

const player = (label: string) => ({ id: label, label, name: label, position: null, team: null, imageUrl: null })
const item = (over: Partial<LeagueActivityItem>): LeagueActivityItem => ({
  id: 'x',
  kind: 'waiver',
  occurredAt: new Date('2026-11-12T15:00:00.000Z'),
  managerName: 'mgr',
  teamName: 'Pig Minnow',
  avatarUrl: null,
  involvedTeams: [],
  adds: [],
  drops: [],
  bid: null,
  picks: [],
  eventId: null,
  ...over,
})

describe('League activity rows', () => {
  it('drops trades — the history above has them — and keeps the order', () => {
    const rows = activityRows([
      item({ id: 'a', kind: 'trade', adds: [player('Kirk Cousins')] }),
      item({ id: 'b', kind: 'waiver', adds: [player('Micah McFadden (LB · NYG)')], bid: 12 }),
      item({ id: 'c', kind: 'roster_move', drops: [player('David Walker (LB · TB)')], teamName: null }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['b', 'c'])
    expect(rows[1].team).toBe('mgr')
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => item({ id: String(i), adds: [player(`P${i}`)] }))
    expect(activityRows(many)).toHaveLength(10)
    expect(activityRows(many, 3)).toHaveLength(3)
  })
})

describe('the activity sentence', () => {
  const row = (over: Partial<ActivityRow>): ActivityRow => ({ id: 'r', team: 'Pig Minnow', kind: 'waiver', adds: [], drops: [], bid: null, at: '2026-11-12T15:00:00.000Z', ...over })
  const en = tradesActivityMessages.en
  const es = { ...en, ...tradesActivityMessages.es }

  it('English: the bid only when one was recorded, adds before drops', () => {
    expect(activityText(row({ adds: ['C.J. Henderson (CB · ATL)'], drops: ['Charlie Jones (WR · NYG)'], bid: 7 }), en)).toBe(
      'added C.J. Henderson (CB · ATL) for $7 · dropped Charlie Jones (WR · NYG)',
    )
    expect(activityText(row({ adds: ['Micah McFadden'] }), en)).toBe('added Micah McFadden')
    expect(activityText(row({ adds: ['Micah McFadden'], bid: 0 }), en)).toBe('added Micah McFadden')
    expect(activityText(row({}), en)).toBe('a waiver claim')
    expect(activityText(row({ kind: 'roster_move' }), en)).toBe('a roster move')
  })

  it('Spanish, and never «waiver»', () => {
    const line = activityText(row({ adds: ['C.J. Henderson'], drops: ['Charlie Jones'], bid: 7 }), es)
    expect(line).toBe('fichó a C.J. Henderson por $7 · soltó a Charlie Jones')
    for (const v of Object.values(tradesActivityMessages.es!)) {
      if (typeof v === 'string') expect(v.toLowerCase()).not.toContain('waiver')
    }
    expect(activityText(row({}), es)).toBe('un reclamo')
  })

  it('every English key has its Spanish pair', () => {
    expect(Object.keys(tradesActivityMessages.es!).sort()).toEqual(Object.keys(tradesActivityMessages.en).sort())
  })
})

describe('the League activity section', () => {
  const rows: ActivityRow[] = [
    { id: '1', team: 'Pig Minnow', kind: 'waiver', adds: ['Micah McFadden (LB · NYG)'], drops: [], bid: null, at: '2026-11-12T15:00:00.000Z' },
    { id: '2', team: null, kind: 'roster_move', adds: [], drops: ['Carson Wentz (QB · MIN)'], bid: null, at: '2026-11-11T15:00:00.000Z' },
  ]

  it('lists each move with its team and day', () => {
    const { getAllByTestId, getByText } = render(<TradesLeagueActivityView rows={rows} language="en" />)
    expect(getByText('League activity')).toBeTruthy()
    const lines = getAllByTestId('trades-league-activity-row').map((li) => li.textContent)
    expect(lines[0]).toContain('Pig Minnow added Micah McFadden (LB · NYG)')
    expect(lines[1]).toContain('A manager dropped Carson Wentz (QB · MIN)')
    expect(lines[0]).toContain('Nov 12')
  })

  it('an empty league and a failed read say different things', () => {
    const empty = render(<TradesLeagueActivityView rows={[]} language="en" />)
    expect(empty.container.textContent).toContain('No adds, drops or claims are on record')
    cleanup()
    const failed = render(<TradesLeagueActivityView rows={null} language="en" />)
    expect(failed.container.textContent).toContain('could not be read')
    expect(failed.container.textContent).not.toContain('No adds, drops')
  })

  it('Spanish', () => {
    const { container } = render(<TradesLeagueActivityView rows={rows} language="es" />)
    expect(container.textContent).toContain('Actividad de la liga')
    expect(container.textContent).toContain('Pig Minnow fichó a Micah McFadden (LB · NYG)')
    expect(container.textContent).toContain('Un mánager soltó a Carson Wentz')
    expect(container.textContent?.toLowerCase()).not.toContain('waiver')
  })
})

describe('a traded pick reads as a pick', () => {
  it('"2027 round 1" is "2027 1st", «2027 · ronda 1» in Spanish; anything else passes through', () => {
    expect(shortPickLabel('2027 round 1', 'en')).toBe('2027 1st')
    expect(shortPickLabel('2028 round 3', 'en')).toBe('2028 3rd')
    expect(shortPickLabel('2028 round 12', 'en')).toBe('2028 12th')
    expect(shortPickLabel('Future round 2', 'en')).toBe('Future 2nd')
    expect(shortPickLabel('2027 round 1', 'es')).toBe('2027 · ronda 1')
    expect(shortPickLabel('2027 1st (via Broncos)', 'en')).toBe('2027 1st (via Broncos)')
  })

  it('the trade card draws each pick as its own chip, not a comma and a run-on value', () => {
    const card = code('components/core-app/screens/Trades.tsx')
    expect(card).toContain('<span className="af-tr-pick-label">{shortPickLabel(pick, language)}</span>')
    expect(card).not.toContain("{side.received.length > 0 || j > 0 ? ', ' : ''}{pick}")
  })
})

describe('the rebuild plan percentage', () => {
  it('a sane ratio prints; one from a near-zero redraft value does not', () => {
    expect(pct(2.23, true)).toBe(123)
    expect(pct(0.77, false)).toBe(23)
    expect(pct(88.24, true)).toBeNull()
    expect(pct(1 + MAX_SHOWN_PCT / 100, true)).toBe(MAX_SHOWN_PCT)
    expect(pct(null, true)).toBeNull()
  })
})

describe('Moves is folded into Trades', () => {
  it('no Moves in the rail, the tab row or the destinations list', () => {
    expect(NAV_SECTION_ORDER.flatMap((s) => s.keys)).not.toContain('moves')
    expect(NAV_SECTION_ORDER.flatMap((s) => s.keys)).toContain('trades')
    expect(code('components/core-app/LeagueTabs.tsx')).not.toMatch(/key: 'moves'/)
    expect(code('components/core-app/AfCoreShell.tsx')).not.toContain('/core/moves?league=')
  })

  it('/core/moves redirects to Trades, keeping ?league=', () => {
    expect(code('next.config.js')).toContain("{ source: '/core/moves', destination: '/core/trades', permanent: false }")
  })

  it('the Trades route streams League activity under the history', () => {
    const page = code('app/core/(shell)/[[...screen]]/page.tsx')
    expect(page).toContain('<TradesLeagueActivity leagueId={trades.league.id} language={language} />')
    expect(code('components/core-app/screens/TradeCenter.tsx')).toContain('{props.activity ? <div className="af-tc-mstep-wrap">{props.activity}</div> : null}')
  })
})

describe('the Trades tab inside a league', () => {
  const tc = () => code('components/core-app/screens/TradeCenter.tsx')

  it('"Create a trade" leads the builder, with the screenshot upload in view', () => {
    expect(tc()).toContain('<h2 className="af-tc-create-title">{lg.createTitle}</h2>')
    expect(tc()).toContain('data-testid="trade-create-screenshot-input"')
    expect(tc()).toContain('if (file) readOfferScreenshot(file)')
  })

  it('no Switch league fold, no "What real trades say", no league-name row', () => {
    expect(tc()).toContain('{props.leagues && props.leagues.length > 0 && !props.league ? (')
    expect(tc()).not.toContain("copy('What real trades say')")
    expect(tc()).not.toContain('<span className="af-tc-context-name">')
  })

  it('the Rebuild plan starts folded', () => {
    expect(tc()).toContain('<details className="af-tc-fold af-tc-rebuild-fold">')
    expect(tc()).not.toMatch(/af-tc-rebuild-fold" open=/)
  })

  it('Spanish for the new builder words', async () => {
    const { tradesLeagueGuideMessages } = await import('@/lib/core-app/messages/tradesLeagueGuide')
    expect(tradesLeagueGuideMessages.es?.createTitle).toBe('Crea un intercambio')
    expect(tradesLeagueGuideMessages.es?.uploadShot).toBe('Sube una captura')
    expect(tradesLeagueGuideMessages.es?.uploadHint?.toLowerCase()).not.toContain('waiver')
  })

  it('the Analyze button and the unnamed other team are Spanish too — they were English on the Spanish page', async () => {
    const { coreUiCopy } = await import('@/lib/core-app/coreUiCopy')
    expect(coreUiCopy('Analyze this trade', 'es')).toBe('Analizar este intercambio')
    expect(coreUiCopy('Their team', 'es')).toBe('Su equipo')
    expect(tc()).toContain("{copy(busy ? 'Analyzing…' : 'Analyze this trade')}")
    expect(tc()).toContain("?? copy('Their team')")
  })
})

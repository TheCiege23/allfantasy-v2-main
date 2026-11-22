// @vitest-environment jsdom
/**
 * The Commissioner Hub's dynasty health: three flags in the existing flag shape (so they rank,
 * render and become "Needs you" cards like the other five), the pick-balance bars and the rollover
 * checklist — and, for every other league, the health section exactly as it was.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { translations } from '@/lib/i18n/translations'
import { interpolateTemplate } from '@/lib/i18n/interpolate'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => {
    const t = (k: string) => translations[h.language]?.[k] ?? translations.en[k] ?? k
    return { language: h.language, setLanguage: () => {}, t, tInterpolate: (k: string, v: Record<string, string | number>) => interpolateTemplate(t(k), v) }
  },
}))

import { pickBalanceFlag, rookieOrderFlag, taxiOverLimitFlag } from '@/lib/core-app/commissioner/dynastyHealthFlags'
import { buildTaskCards } from '@/lib/core-app/commissioner/tasks'
import { rankFlags, type HealthFlag } from '@/lib/core-app/commissioner/health'
import { DynastyHealthPanel } from '@/components/core-app/commissioner/DynastyHealthPanel'
import { HealthPanel, TaskCards } from '@/components/core-app/commissioner/HubSections'
import type { CommissionerHubData, CommissionerHubDynasty } from '@/lib/core-app/commissionerHub'
import type { DynastyPickBalance } from '@/lib/commissioner-hub/dynastyHealthSignals'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

const LINK = { label: '', href: '#ch-dynasty-picks', external: false }

const balanced: DynastyPickBalance = {
  measured: true,
  seasons: [2027, 2028, 2029],
  average: 9,
  rows: [
    { rosterId: 'a', teamName: 'Wolves', isViewer: true, total: 10, inNextDraft: 3, flag: null },
    { rosterId: 'b', teamName: 'Owls', isViewer: false, total: 8, inNextDraft: 3, flag: null },
  ],
}
const lopsided: DynastyPickBalance = {
  measured: true,
  seasons: [2027, 2028, 2029],
  average: 9,
  rows: [
    { rosterId: 'a', teamName: 'Wolves', isViewer: true, total: 22, inNextDraft: 8, flag: 'heavy' },
    { rosterId: 'b', teamName: 'Owls', isViewer: false, total: 9, inNextDraft: 3, flag: null },
    { rosterId: 'c', teamName: null, isViewer: false, total: 2, inNextDraft: 0, flag: 'none_next' },
  ],
}

const measured = (f: HealthFlag) => {
  if (!f.measured) throw new Error(`expected ${f.key} measured`)
  return f
}

describe('pick balance flag', () => {
  it('names the teams with no next-draft pick and the heavy holder, with real counts', () => {
    const f = measured(pickBalanceFlag(lopsided, LINK))
    expect(f).toMatchObject({ key: 'picks', severity: 'warn', count: 2 })
    expect(f.headline).toBe('1 team holds no 2027 pick · 1 team holds far more picks than average')
    expect(f.detail).toContain('No 2027 pick: Unnamed team.')
    expect(f.detail).toContain('Wolves (22)')
    expect(f.detail).toContain('league average of 9 across the next 3 drafts')
    expect(f.action).toEqual({ label: 'See pick balance', href: '#ch-dynasty-picks', external: false })
  })

  it('a balanced league is green with no action', () => {
    const f = measured(pickBalanceFlag(balanced, LINK))
    expect(f).toMatchObject({ severity: 'good', count: 0, action: null, headline: 'Every team holds a 2027 pick' })
  })

  it.each(['missing', 'partial', 'empty', 'no_teams'] as const)('🛑 an unmeasured read (%s) says why and never counts', (reason) => {
    const f = pickBalanceFlag({ measured: false, reason }, LINK)
    expect(f.measured).toBe(false)
    expect(f.action).toBeNull()
    if (!f.measured) expect(f.reason).not.toMatch(/commishHub\./)
  })

  it('Spanish, with no «waiver»', () => {
    const f = measured(pickBalanceFlag(lopsided, LINK, 'es'))
    expect(f.headline).toBe('1 equipo no tiene selección de 2027 · 1 equipo tiene muchas más selecciones que la media')
    expect(f.detail).toContain('Equipo sin nombre')
    expect(`${f.headline} ${f.detail} ${f.label}`.toLowerCase()).not.toContain('waiver')
  })
})

describe('taxi flag', () => {
  it('names each team over the limit with its count', () => {
    const f = measured(taxiOverLimitFlag({ measured: true, limit: 3, teams: [{ rosterId: 'x', teamName: 'Owls', held: 5 }, { rosterId: 'y', teamName: 'Hawks', held: 4 }] }, LINK))
    expect(f).toMatchObject({ key: 'taxi', severity: 'warn', count: 2, headline: '2 teams are over the 3-slot taxi limit' })
    expect(f.detail).toBe('Over the limit: Owls (5), Hawks (4). Each needs to promote or release a taxi player.')
    expect(f.action?.label).toBe('Open league')
  })

  it('within the limit is green', () => {
    expect(measured(taxiOverLimitFlag({ measured: true, limit: 3, teams: [] }, LINK))).toMatchObject({ severity: 'good', count: 0, action: null })
  })

  it('no limit on file, no rosters, or a failed read: unmeasured', () => {
    expect(taxiOverLimitFlag({ measured: false, reason: 'no_limit' }, LINK).measured).toBe(false)
    expect(taxiOverLimitFlag({ measured: false, reason: 'no_rosters' }, LINK).measured).toBe(false)
    const unread = taxiOverLimitFlag(null, LINK, 'es')
    expect(unread.measured === false && unread.reason).toBe('No se pudieron leer las escuadras taxi de esta liga en este momento.')
  })
})

describe('rookie draft order flag', () => {
  const base = { season: 2026, nextSeason: 2027, seasonOver: true, started: false, rookieDraft: 'none' as const, draftOrder: { source: 'standings' as const, finalOrderSaved: false } }
  const ACTION = { label: '', href: '#ch-rollover', external: false }

  it('🛑 not set between seasons: needs the commissioner, with the method it will use', () => {
    const f = measured(rookieOrderFlag({ kind: 'native', rollover: base }, ACTION))
    expect(f).toMatchObject({ key: 'rookie_order', severity: 'warn', count: 1, headline: 'The 2027 rookie draft order isn’t set' })
    expect(f.detail).toContain('worst record first')
    expect(f.action).toEqual({ label: 'Open the rollover wizard', href: '#ch-rollover', external: false })
  })

  it('set once the rookie draft exists, or the live order saved its final order', () => {
    expect(measured(rookieOrderFlag({ kind: 'native', rollover: { ...base, rookieDraft: 'open' } }, ACTION)).severity).toBe('good')
    expect(measured(rookieOrderFlag({ kind: 'native', rollover: { ...base, draftOrder: { source: 'live_order', finalOrderSaved: true } } }, ACTION)).severity).toBe('good')
    expect(measured(rookieOrderFlag({ kind: 'native', rollover: { ...base, rookieDraft: 'complete' } }, ACTION)).detail).toBe('The 2027 rookie draft is done.')
  })

  it('mid-season it is not due — green, never "not set"', () => {
    const f = measured(rookieOrderFlag({ kind: 'native', rollover: { ...base, seasonOver: false } }, ACTION))
    expect(f).toMatchObject({ severity: 'good', headline: 'Set when the 2026 season ends' })
  })

  it('no finished season, or an imported league: unmeasured, with the reason', () => {
    expect(rookieOrderFlag({ kind: 'native', rollover: null }, ACTION).measured).toBe(false)
    const imp = rookieOrderFlag({ kind: 'imported', platformLabel: 'Sleeper' }, ACTION, 'es')
    expect(imp.measured === false && imp.reason).toBe('Sleeper fija el orden del draft de novatos de esta liga, así que no se revisa aquí.')
  })
})

describe('the "Needs you" list', () => {
  it('a red dynasty flag becomes a task card in the existing shape; a green one does not', () => {
    const flags = rankFlags([
      pickBalanceFlag(lopsided, LINK),
      taxiOverLimitFlag({ measured: true, limit: 3, teams: [] }, LINK),
    ])
    const { cards } = buildTaskCards({ issues: [], flags, calendar: [], workspace: [] })
    expect(cards.map((c) => c.id)).toEqual(['flag:picks'])
    expect(cards[0]).toMatchObject({ source: 'health', severity: 'warn', action: { href: '#ch-dynasty-picks' } })
  })
})

// ── The UI ──────────────────────────────────────────────────────────────────

const DYNASTY: CommissionerHubDynasty = {
  picks: lopsided,
  taxi: { measured: true, limit: 3, teams: [] },
  rollover: {
    season: 2026,
    nextSeason: 2027,
    seasonOver: true,
    started: false,
    steps: [
      { key: 'season', state: 'done' },
      { key: 'draft_order', state: 'todo' },
      { key: 'taxi', state: 'done' },
      { key: 'dues', state: 'optional' },
      { key: 'schedule', state: 'optional' },
      { key: 'start', state: 'todo' },
    ],
    wizardHref: '#ch-rollover',
  },
}

describe('DynastyHealthPanel', () => {
  it('draws one bar per team, the viewer as "Your team", the empty one flagged', () => {
    render(<DynastyHealthPanel dynasty={DYNASTY} />)
    const rows = screen.getAllByTestId('dynasty-pick-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveAttribute('data-tone', 'you')
    expect(within(rows[0]).getByText('Your team')).toBeTruthy()
    expect(rows[2]).toHaveAttribute('data-tone', 'low')
    expect(within(rows[2]).getByText('No 2027 pick')).toBeTruthy()
    expect(within(rows[0]).getByText('Far above average')).toBeTruthy()
    // Widths are relative to the most picks held: 22 → 100%, 2 → 9%.
    expect((rows[0].querySelector('.af-ch-dyn-bar-fill') as HTMLElement).style.width).toBe('100%')
    expect((rows[2].querySelector('.af-ch-dyn-bar-fill') as HTMLElement).style.width).toBe('9%')
    expect(screen.getByText('Pick balance · next 3 drafts')).toBeTruthy()
  })

  it('lists the rollover wizard’s own steps with their real states, and links to the wizard', () => {
    render(<DynastyHealthPanel dynasty={DYNASTY} />)
    expect(screen.getByTestId('dynasty-rollover-draft_order')).toHaveAttribute('data-state', 'todo')
    expect(screen.getByTestId('dynasty-rollover-season')).toHaveAttribute('data-state', 'done')
    expect(screen.getByText('Rollover readiness · 2027')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the rollover wizard' })).toHaveAttribute('href', '#ch-rollover')
  })

  it('no wizard on the screen, no link; mid-season says when the steps open', () => {
    render(<DynastyHealthPanel dynasty={{ ...DYNASTY, rollover: { ...DYNASTY.rollover!, seasonOver: false, wizardHref: null } }} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('These open once the 2026 season ends.')).toBeTruthy()
  })

  it('🛑 unmeasured picks draw no bars, and with no rollover either it draws nothing', () => {
    const { container } = render(<DynastyHealthPanel dynasty={{ ...DYNASTY, picks: { measured: false, reason: 'partial' }, rollover: null }} />)
    expect(container.innerHTML).toBe('')
  })

  it('Spanish', () => {
    h.language = 'es'
    render(<DynastyHealthPanel dynasty={DYNASTY} />)
    expect(screen.getByText('Equilibrio de selecciones · próximos 3 drafts')).toBeTruthy()
    expect(screen.getByText('Tu equipo')).toBeTruthy()
    expect(screen.getByText('Preparación del cambio de temporada · 2027')).toBeTruthy()
    expect(screen.getByText('Orden del draft de novatos')).toBeTruthy()
  })
})

function hubData(over: Partial<CommissionerHubData> = {}): CommissionerHubData {
  return {
    health: {
      score: { available: true, data: { score: 71, status: 'healthy', summary: 'Healthy league', confidencePct: 80 } },
      flags: [],
    },
    tasks: { cards: [{ id: 'flag:dues', severity: 'warn', source: 'health', title: '2 teams still owe dues', detail: 'Owls, Hawks.', due: null, action: null }], overflow: [] },
    tasksEmptyReason: null,
    ...over,
  } as unknown as CommissionerHubData
}

describe('the health section', () => {
  it('🛑 a non-dynasty league renders exactly as it did: no dress, no dynasty panel', () => {
    const data = hubData()
    const html = renderToStaticMarkup(<><HealthPanel data={data} /><TaskCards data={data} /></>)
    expect(html).not.toContain('af-ch-dyn')
    expect(html).not.toContain('dynasty-health')
    // `dynasty: null` is the same screen as no key at all.
    expect(renderToStaticMarkup(<><HealthPanel data={hubData({ dynasty: null })} /><TaskCards data={hubData({ dynasty: null })} /></>)).toBe(html)
    expect(html).toContain('class="af-card af-ch-section" aria-labelledby="ch-health-h"')
    expect(html).toContain('class="af-card af-ch-section af-ch-tasks-section"')
  })

  it('a dynasty league wears the Dynasty Era dress on health and "Needs you", with the panel', () => {
    const html = renderToStaticMarkup(<><HealthPanel data={hubData({ dynasty: DYNASTY })} /><TaskCards data={hubData({ dynasty: DYNASTY })} /></>)
    expect(html).toContain('class="af-card af-ch-section af-ch-dyn" aria-labelledby="ch-health-h"')
    expect(html).toContain('class="af-card af-ch-section af-ch-tasks-section af-ch-dyn"')
    expect(html).toContain('data-testid="dynasty-health"')
  })
})

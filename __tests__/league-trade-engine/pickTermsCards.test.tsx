/** Conditional and protected picks — the Trade Center editor, the Trades page card and the Trade settings panel, in both languages. */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  const t = (k: string) => translations[lang.language][k] ?? translations.en[k] ?? k
  return {
    useOptionalLanguage: () => ({
      language: lang.language,
      t,
      tInterpolate: (k: string, vars: Record<string, string | number>) => t(k).replace(/\{\{(\w+)\}\}/g, (_: string, v: string) => String(vars[v] ?? '')),
    }),
  }
})

import { PickTermsEditor, type OfferPick } from '@/components/core-app/PickTermsEditor'
import { PickTermsCard } from '@/components/core-app/PickTermsCard'
import { PickTermsPanel } from '@/components/league-settings/PickTermsPanel'
import type { PickTerms } from '@/lib/league-trade-engine/pickTerms'

const teams = [
  { rosterId: 'rA', name: 'Alpha' },
  { rosterId: 'rB', name: 'Bravo' },
  { rosterId: 'rC', name: 'Charlie' },
  { rosterId: 'rD', name: 'Delta' },
]
const view = (over: Record<string, unknown> = {}) => ({
  supported: true as const,
  enabled: true,
  active: true,
  isCommissioner: false,
  canEdit: false,
  teams,
  rounds: 4,
  picks: [] as any[],
  ...over,
})

const stub = (body: unknown, post: { ok: boolean; body: unknown } = { ok: true, body: { ok: true } }) => {
  const f = vi.fn(async (_u: string, init?: { method?: string }) =>
    init?.method === 'POST' ? { ok: post.ok, json: async () => post.body } : { ok: true, json: async () => body },
  )
  vi.stubGlobal('fetch', f)
  return f
}
const posted = (f: ReturnType<typeof stub>) => f.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => JSON.parse(String((c[1] as { body: string }).body)))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  lang.language = 'en'
})

const pick: OfferPick = { pickId: 'fdp:2027:2:rA', label: '2027 Round 2 (Alpha)', round: 2, originalRosterId: 'rA' }

function Harness(props: { v: ReturnType<typeof view>; picks?: OfferPick[]; onTerms?: (t: Record<string, PickTerms | undefined>) => void }) {
  const [value, setValue] = React.useState<Record<string, PickTerms | undefined>>({})
  return (
    <PickTermsEditor
      view={props.v}
      picks={props.picks ?? [pick]}
      value={value}
      onChange={(id, terms) => {
        const next = { ...value, [id]: terms }
        setValue(next)
        props.onTerms?.(next)
      }}
    />
  )
}

describe('the Trade Center editor', () => {
  it('gives a pick protection, offering top 1 to one less than the team count', () => {
    let last: Record<string, PickTerms | undefined> = {}
    render(<Harness v={view()} onTerms={(t) => (last = t)} />)
    fireEvent.change(screen.getByTestId('pick-terms-kind'), { target: { value: 'protected' } })
    const top = screen.getByTestId('pick-terms-top') as HTMLSelectElement
    expect(Array.from(top.options).map((o) => o.value)).toEqual(['1', '2', '3'])
    fireEvent.change(top, { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('pick-terms-if'), { target: { value: 'rolls_over' } })
    expect(last['fdp:2027:2:rA']).toEqual({ kind: 'protected', top: 2, ifProtected: 'rolls_over' })
    expect(screen.getByTestId('pick-terms-summary').textContent).toBe("top-2 protected (if it lands 1–2, Alpha's same-round pick the next year conveys instead)")
  })

  it('gives a pick a condition on another team, never offering its own round', () => {
    let last: Record<string, PickTerms | undefined> = {}
    render(<Harness v={view()} onTerms={(t) => (last = t)} />)
    fireEvent.change(screen.getByTestId('pick-terms-kind'), { target: { value: 'conditional' } })
    fireEvent.change(screen.getByTestId('pick-terms-team'), { target: { value: 'rB' } })
    const effect = screen.getByTestId('pick-terms-effect') as HTMLSelectElement
    expect(Array.from(effect.options).map((o) => o.value)).toEqual(['1', '3', '4', 'void'])
    fireEvent.change(effect, { target: { value: '1' } })
    expect(last['fdp:2027:2:rA']).toEqual({ kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 1 })
    fireEvent.change(effect, { target: { value: 'void' } })
    expect(last['fdp:2027:2:rA']).toMatchObject({ effect: 'does_not_convey', round: undefined })
    fireEvent.change(screen.getByTestId('pick-terms-kind'), { target: { value: 'none' } })
    expect(last['fdp:2027:2:rA']).toBeUndefined()
  })

  it('shows a pick that already carries terms read-only, and renders nothing when terms are off', () => {
    const carried = { pickId: pick.pickId, season: 2027, round: 2, original: 'Alpha', holder: 'Bravo', terms: { kind: 'protected', top: 3, ifProtected: 'stays' }, outcome: null, note: null, outcomeRound: null }
    render(<Harness v={view({ picks: [carried] })} />)
    expect(screen.queryByTestId('pick-terms-kind')).toBeNull()
    expect(screen.getByTestId('pick-terms-editor').textContent).toContain('Already carries terms: top-3 protected')
    cleanup()
    const { container } = render(<Harness v={view({ active: false })} />)
    expect(container.innerHTML).toBe('')
  })

  it('speaks Spanish, with no «waiver»', () => {
    lang.language = 'es'
    render(<Harness v={view()} />)
    fireEvent.change(screen.getByTestId('pick-terms-kind'), { target: { value: 'conditional' } })
    const text = screen.getByTestId('pick-terms-editor').textContent ?? ''
    expect(text).toContain(translations.es['pickTerms.title'])
    expect(screen.getByTestId('pick-terms-summary').textContent).toBe('pasa a ser de ronda 1 si Alpha no llega a playoffs')
    expect(text.toLowerCase()).not.toContain('waiver')
  })
})

describe('the Trades page card', () => {
  const picks = [
    { pickId: 'fdp:2027:1:rA', season: 2027, round: 1, original: 'Alpha', holder: 'Bravo', terms: { kind: 'protected', top: 3, ifProtected: 'stays' }, outcome: null, note: null, outcomeRound: null },
    { pickId: 'fdp:2026:2:rC', season: 2026, round: 2, original: 'Charlie', holder: 'Alpha', terms: { kind: 'conditional', teamRosterId: 'rD', event: 'misses_playoffs', effect: 'becomes_round', round: 1 }, outcome: 'became_round', note: null, outcomeRound: 1 },
  ]

  it('lists each pick, its holder, its terms and how they settled', async () => {
    stub(view({ picks }))
    render(<PickTermsCard leagueId="L" />)
    const items = await screen.findAllByTestId('pick-terms-item')
    expect(items.map((i) => i.textContent)).toEqual([
      '2027 round 1 (Alpha) · held by Bravo · top-3 protected (if it lands 1–3, it stays with Alpha) — settled when that rookie draft is created',
      '2026 round 2 (Charlie) · held by Alpha · becomes a 1st if Delta misses the playoffs — became the round 1 pick',
    ])
  })

  it('in Spanish', async () => {
    lang.language = 'es'
    stub(view({ picks }))
    render(<PickTermsCard leagueId="L" />)
    const items = await screen.findAllByTestId('pick-terms-item')
    expect(items[1]!.textContent).toContain('pasa a ser de ronda 1 si Delta no llega a playoffs')
    expect(items[1]!.textContent).toContain(translations.es['pickTerms.outcome.became_round']!.replace('{{round}}', '1'))
  })

  it('renders nothing when no pick carries terms', async () => {
    stub(view())
    const { container } = render(<PickTermsCard leagueId="L" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})

describe('the Trade settings panel', () => {
  it('a commissioner on the plan switches it on', async () => {
    const f = stub(view({ enabled: false, active: false, isCommissioner: true, canEdit: true }))
    render(<PickTermsPanel leagueId="L" />)
    fireEvent.click(await screen.findByRole('switch'))
    fireEvent.click(screen.getByTestId('pick-terms-save'))
    await waitFor(() => expect(posted(f)).toEqual([{ rule: { enabled: true } }]))
  })

  it('without the plan a commissioner sees the upgrade link and cannot switch it on, but can switch it off', async () => {
    stub(view({ enabled: false, active: false, isCommissioner: true, canEdit: false }))
    render(<PickTermsPanel leagueId="L" />)
    expect(await screen.findByTestId('pick-terms-upgrade')).toBeTruthy()
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    stub(view({ enabled: true, active: false, isCommissioner: true, canEdit: false }))
    render(<PickTermsPanel leagueId="L" />)
    expect((await screen.findByTestId('pick-terms-status')).textContent).toBe(translations.en['lsPickTerms.status.lapsed'])
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a member sees it read-only, in Spanish', async () => {
    lang.language = 'es'
    stub(view())
    render(<PickTermsPanel leagueId="L" />)
    expect((await screen.findByTestId('pick-terms-status')).textContent).toBe(translations.es['lsPickTerms.status.on'])
    expect(screen.queryByTestId('pick-terms-save')).toBeNull()
  })
})

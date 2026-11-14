import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'

afterEach(cleanup)

describe('Trade Center Spanish orientation', () => {
  it('explains the cross-league starting point', () => {
    render(<TradeCenter league={null} />)
    // The all-leagues page leads with the trades guide (2026-11-13): what it is for, in Spanish.
    expect(screen.getByRole('heading', { level: 1, name: 'Intercambios en tus ligas' })).toBeTruthy()
    expect(document.body.textContent).toContain('Revisa una oferta antes de aceptarla')
    expect(screen.getByRole('heading', { name: 'Revisa un intercambio' })).toBeTruthy()
  })

  it('keeps the calculator, its folds and the trade handoff understandable', () => {
    const { container } = render(<TradeCenter league={{ id: 'l1', name: 'Liga Uno', format: 'Dinastía', teamCount: 12 }} />)
    // 2026-11-13: the headline is the trade deadline; with none known it says what the page is for.
    expect(screen.getByRole('heading', { level: 1, name: 'Arma un intercambio y recibe su calificación' })).toBeTruthy()
    expect(document.body.textContent).toContain('Añade lo que envías y lo que recibes')
    // Each side's total bar, and the empty state under it.
    expect(container.querySelector(".af-tc-team[data-side='give'] .af-tc-side-bar")!.textContent).toContain('Envías')
    expect(container.querySelector(".af-tc-team[data-side='get'] .af-tc-side-bar")!.textContent).toContain('Recibes')
    expect(container.querySelector('.af-tc-builder')!.textContent).toContain('Todavía no añadiste nada')
    // The search controls and the balance bar's button.
    expect(container.querySelector(".af-tc-team[data-side='give'] .af-tc-add")!.textContent).toContain('Busca tus jugadores, selecciones o FAAB')
    expect(container.querySelector('.af-tc-stepbar-primary')!.textContent).toBe('Añade lo que recibes')
    // The folded offers section, with the draft explanation inside it.
    const offers = container.querySelector('details.af-tc-offers')!
    expect(offers.querySelector('summary')!.textContent).toContain('Ofertas, borradores y alertas')
    expect(offers.textContent).toContain('Los borradores se guardan en tu cuenta')
  })
})

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
    expect(screen.getByRole('heading', { name: 'Centro de intercambios' })).toBeTruthy()
    expect(document.body.textContent).toContain('Elige la liga para intercambiar')
  })

  it('keeps the calculator, its folds and the trade handoff understandable', () => {
    const { container } = render(<TradeCenter league={{ id: 'l1', name: 'Liga Uno', format: 'Dinastía', teamCount: 12 }} />)
    expect(screen.getByRole('heading', { name: 'Centro de intercambios' })).toBeTruthy()
    expect(document.body.textContent).toContain('añade lo que envías y recibes')
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

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

  it('keeps the phone steps and trade handoff understandable', () => {
    render(<TradeCenter league={{ id: 'l1', name: 'Liga Uno', format: 'Dinastía', teamCount: 12 }} />)
    expect(screen.getByRole('heading', { name: 'Centro de intercambios' })).toBeTruthy()
    expect(document.body.textContent).toContain('añade lo que envías y recibes')
    expect(screen.getByRole('navigation', { name: 'Pasos del intercambio' }).textContent).toContain('Ofertas')
    expect(screen.getByRole('navigation', { name: 'Pasos del intercambio' }).textContent).toContain('Revisar')
    expect(document.body.textContent).toContain('Los borradores se guardan en tu cuenta')
    expect(screen.getByRole('region', { name: 'Resumen del intercambio' }).textContent).toContain('Todavía no añadiste nada')
  })
})

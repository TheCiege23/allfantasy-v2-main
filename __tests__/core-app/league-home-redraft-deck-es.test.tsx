import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * The redraft season-race deck reads its words from a catalog (lib/core-app/messages/redraftHomeDeck.ts),
 * so a Spanish reader gets Spanish — it used to be English-only literals. The English half is pinned by
 * league-home-redraft-deck-render.test.tsx.
 */

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es', t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { RedraftHomeDeck } from '@/components/core-app/screens/RedraftHomeDeck'
import { homeFixture } from '@/app/e2e/redraft-core/home/fixture'

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ')

describe('RedraftHomeDeck in Spanish', () => {
  it('names the race, the line and the recap in Spanish', () => {
    const { data } = homeFixture('nba', { identity: true })
    const { container } = render(<RedraftHomeDeck deck={data.redraft!} leagueId="L" season={2026} />)
    const deck = container.querySelector('[data-testid=redraft-home-deck]')
    expect(deck?.getAttribute('aria-label')).toBe('Carrera de la temporada')
    expect(text(deck)).toContain('Temporada regular · semana 3 de 19')
    expect(text(container.querySelector('[data-testid=redraft-playoff-race]'))).toContain('Los 6 primeros clasifican')
    expect(container.querySelector('[role=separator]')?.getAttribute('aria-label')).toBe('Línea de playoffs')
    expect(text(container.querySelector('[data-testid=redraft-recap]'))).toContain('Puntuación más alta')
    expect(text(deck)).not.toMatch(/Playoff race|Top score|Win odds/)
  })
})

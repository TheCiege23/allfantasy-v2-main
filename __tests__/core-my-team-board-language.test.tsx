import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MyTeamPulse } from '@/lib/core-app/myTeamPulse'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import { MyTeamBoard } from '@/components/core-app/MyTeamBoard'

describe('Spanish cross-league My Team board', () => {
  it('explains an unconnected account and offers a clear next action', () => {
    const pulse = {
      needs: [], set: [], needsTotal: 0, setTotal: 0, considered: 0, checked: 0,
      byeChecked: false, notChecked: { noRoster: 0, noLineup: 0 },
    } as MyTeamPulse

    const { container } = render(<MyTeamBoard pulse={pulse} allHref="/core/my-team?all=1" now={0} />)
    expect(screen.getByRole('heading', { name: 'Mi equipo' })).toBeTruthy()
    expect(container.textContent).toContain('Aún no hay equipos asignados a esta cuenta, así que no hay alineaciones que revisar.')
    expect(screen.getByRole('link', { name: 'Conectar plataforma' })).toHaveAttribute('href', '/import')
  })

  it('distinguishes missing data from a clean lineup in Spanish', () => {
    const pulse = {
      needs: [], set: [], needsTotal: 0, setTotal: 0, considered: 1, checked: 0,
      byeChecked: false, notChecked: { noRoster: 1, noLineup: 0 },
    } as MyTeamPulse

    const { container } = render(<MyTeamBoard pulse={pulse} allHref="/core/my-team?all=1" now={0} />)
    expect(container.textContent).toContain('No pudimos leer ninguna alineación.')
    expect(container.textContent).toContain('1 sin plantilla importada')
    expect(container.textContent).toContain('Faltan datos; esto no evalúa esas alineaciones.')
    expect(container.textContent).not.toContain('todas las alineaciones están listas')
  })
})

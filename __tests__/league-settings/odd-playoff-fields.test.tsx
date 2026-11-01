import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlayoffSettingsPanel } from '@/app/league/[leagueId]/components/settings/PlayoffSettingsPanel'

/*
 * Odd playoff fields (3, 5 … 15) are offered to every commissioner, free, like the even ones (owner's
 * rule, 08d407e24 / free-commissioner-locks.test.ts; reconfirmed 2026-10-25). Capped at 16 and at the
 * league size.
 */
function fieldSelect(): HTMLSelectElement {
  return screen.getAllByRole('combobox').find((el) =>
    [...(el as HTMLSelectElement).options].some((o) => o.textContent === '3'),
  ) as HTMLSelectElement
}

describe('playoff field choices', () => {
  it('a 20-team league can pick any field from 3 to 16, odd or even', () => {
    render(<PlayoffSettingsPanel initialData={{ sport: 'NFL', leagueSize: 20, playoffTeams: 6, playoffStartWeek: 14 } as never} canEdit debouncedSave={vi.fn()} />)
    const values = [...fieldSelect().options].map((o) => Number(o.value))
    expect(values).toEqual(Array.from({ length: 14 }, (_, i) => i + 3))
    for (const odd of [3, 5, 7, 9]) expect([...fieldSelect().options].find((o) => Number(o.value) === odd)!.disabled).toBe(false)
  })

  it('never more than the league has teams', () => {
    render(<PlayoffSettingsPanel initialData={{ sport: 'NFL', leagueSize: 7, playoffTeams: 4, playoffStartWeek: 15 } as never} canEdit debouncedSave={vi.fn()} />)
    expect([...fieldSelect().options].map((o) => Number(o.value))).toEqual([3, 4, 5, 6, 7])
  })
})

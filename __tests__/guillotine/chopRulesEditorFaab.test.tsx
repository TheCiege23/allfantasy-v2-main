import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GuillotineChopRulesEditor } from '@/components/league-settings/home/GuillotineChopRulesEditor'
import { DEFAULT_ADVANCED, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'

afterEach(cleanup)

const props = (over: Partial<Parameters<typeof GuillotineChopRulesEditor>[0]> = {}) => ({
  initial: null, baseChops: 1, startWeek: 1, endWeek: 14, hasAfCommissionerSub: true,
  save: vi.fn(async (a: GuillotineAdvanced) => ({ ok: true as const, value: a, lines: [] })), ...over,
})

describe('chop rules editor — FAAB after a chop', () => {
  it('saves a top-up amount and shows it in the season summary', async () => {
    const p = props()
    render(<GuillotineChopRulesEditor {...p} />)
    expect(screen.queryByTestId('guillotine-faab-amount')).toBeNull()
    fireEvent.change(screen.getByTestId('guillotine-faab-mode'), { target: { value: 'add' } })
    fireEvent.change(screen.getByTestId('guillotine-faab-amount'), { target: { value: '30' } })
    expect(screen.getByText('After each chop, every surviving team gets $30 more FAAB.')).toBeTruthy()
    fireEvent.click(screen.getByTestId('lsh-save'))
    await waitFor(() => expect(p.save).toHaveBeenCalledTimes(1))
    expect(p.save.mock.calls[0][0].faab).toEqual({ mode: 'add', amount: 30 })
  })

  it('reads rules saved before FAAB existed as unchanged', () => {
    const { faab: _drop, ...old } = DEFAULT_ADVANCED
    render(<GuillotineChopRulesEditor {...props({ initial: { ...old, immunity: 'top_scorer' } as GuillotineAdvanced })} />)
    expect((screen.getByTestId('guillotine-faab-mode') as HTMLSelectElement).value).toBe('unchanged')
  })

  it('cannot save a FAAB rule without AF Commissioner', () => {
    render(<GuillotineChopRulesEditor {...props({ hasAfCommissionerSub: false })} />)
    fireEvent.change(screen.getByTestId('guillotine-faab-mode'), { target: { value: 'set' } })
    expect((screen.getByTestId('lsh-save') as HTMLButtonElement).disabled).toBe(true)
  })
})

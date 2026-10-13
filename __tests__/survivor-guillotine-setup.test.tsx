import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SurvivorGuillotineSetup } from '@/components/survivor-guillotine/SurvivorGuillotineSetup'

afterEach(cleanup)

describe('Survivor Guillotine commissioner workshop', () => {
  it('opens with a valid football schedule and snake draft', () => {
    render(<SurvivorGuillotineSetup />)
    expect(screen.getByText('Season fits · three finalists remain')).toBeTruthy()
    expect((screen.getByLabelText('New tribe draft') as HTMLSelectElement).value).toBe('snake')
    expect((screen.getByRole('button', { name: 'Export season rules' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByLabelText('Allow trading (off by default)') as HTMLInputElement).checked).toBe(false)
  })
  it('blocks exporting an impossible schedule and allows correcting it', () => {
    render(<SurvivorGuillotineSetup />)
    fireEvent.change(screen.getByLabelText('Starting managers'), { target: { value: '24' } })
    expect(screen.getByText(/Schedule leaves 5 finalists/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Export season rules' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Starting managers'), { target: { value: '22' } })
    expect(screen.getByText('Season fits · three finalists remain')).toBeTruthy()
  })
  it('supports NBA scoring controls and an All-Star no-elimination period', () => {
    render(<SurvivorGuillotineSetup />)
    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'NBA' } })
    expect(screen.getByRole('heading', { name: 'NBA scoring calendar' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Championship scoring period'), { target: { value: '18' } })
    fireEvent.change(screen.getByLabelText('Period 8 format'), { target: { value: 'off' } })
    expect(screen.getByText('Season fits · three finalists remain')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Weekly scoring'), { target: { value: 'capped_games' } })
    expect(screen.getByLabelText('Player games per team / period')).toBeTruthy()
  })
})

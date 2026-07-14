import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CommissionerControlCenterModal } from '@/components/app/draft-room/CommissionerControlCenterModal'

function renderModal(timerSeconds: number | null = 90) {
  const onAction = vi.fn().mockResolvedValue({ ok: true })
  const onSettingsPatch = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  const onResync = vi.fn()
  render(
    <CommissionerControlCenterModal
      leagueId="league-1"
      draftStatus="paused"
      draftType="snake"
      draftUISettings={{ timerMode: 'per_pick' } as any}
      timerSeconds={timerSeconds}
      onClose={onClose}
      onAction={onAction}
      onSettingsPatch={onSettingsPatch}
      onResync={onResync}
    />,
  )
  return { onAction, onSettingsPatch }
}

describe('CommissionerControlCenterModal — timer UI (Slice B.1)', () => {
  it('renders the new timer-preset section (visible B.1 marker) inside the same modal that owns "Skip pick is disabled by league rules."', () => {
    renderModal(90)
    expect(screen.getByTestId('timer-preset-select-active')).toBeTruthy()
    expect(screen.getByText(/Skip pick is/i)).toBeTruthy()
  })

  it('does not render the legacy number input for timer', () => {
    renderModal(90)
    const timerSelect = screen.getByTestId('draft-commissioner-timer-preset')
    expect(timerSelect.tagName).toBe('SELECT')
    expect((timerSelect as HTMLSelectElement).type).not.toBe('number')
    // No <input type="number"> survived in this section.
    const section = screen.getByTestId('timer-preset-select-active')
    const numberInputs = section.querySelectorAll('input[type="number"]')
    // Only the optional custom-amount input may be a number input, and only when 'Set amount' is selected.
    expect(numberInputs.length).toBe(0)
  })

  it('exposes 10 seconds, Off, and Set amount options', () => {
    renderModal(90)
    const select = screen.getByTestId('draft-commissioner-timer-preset') as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.textContent)
    expect(labels).toContain('10 seconds')
    expect(labels).toContain('Off')
    expect(labels).toContain('Set amount')
  })

  it('shows custom amount + unit inputs when Set amount is selected, allowing custom 15 seconds', async () => {
    const { onAction } = renderModal(90)
    const select = screen.getByTestId('draft-commissioner-timer-preset') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'custom' } })

    const amount = screen.getByTestId('draft-commissioner-timer-custom-amount') as HTMLInputElement
    const unit = screen.getByTestId('draft-commissioner-timer-custom-unit') as HTMLSelectElement
    expect(amount).toBeTruthy()
    expect(unit).toBeTruthy()

    fireEvent.change(unit, { target: { value: 'seconds' } })
    fireEvent.change(amount, { target: { value: '15' } })
    fireEvent.blur(amount)

    fireEvent.click(screen.getByTestId('draft-commissioner-set-timer'))
    expect(onAction).toHaveBeenCalledWith('set_timer_seconds', { seconds: 15, resetCurrentTimer: true })
  })

  it('Off resolves to 0 seconds when committed', async () => {
    const { onAction } = renderModal(90)
    const select = screen.getByTestId('draft-commissioner-timer-preset') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'off' } })
    fireEvent.click(screen.getByTestId('draft-commissioner-set-timer'))
    expect(onAction).toHaveBeenCalledWith('set_timer_seconds', { seconds: 0, resetCurrentTimer: true })
  })

  it('clearing the custom-amount input leaves it blank (does not insert 0)', () => {
    renderModal(90)
    const select = screen.getByTestId('draft-commissioner-timer-preset') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'custom' } })
    const amount = screen.getByTestId('draft-commissioner-timer-custom-amount') as HTMLInputElement
    fireEvent.change(amount, { target: { value: '15' } })
    fireEvent.change(amount, { target: { value: '1' } })
    fireEvent.change(amount, { target: { value: '' } })
    expect(amount.value).toBe('')
  })

  it('switching to Set amount starts blank in seconds (no fight with default)', () => {
    renderModal(90)
    const select = screen.getByTestId('draft-commissioner-timer-preset') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'custom' } })
    const amount = screen.getByTestId('draft-commissioner-timer-custom-amount') as HTMLInputElement
    const unit = screen.getByTestId('draft-commissioner-timer-custom-unit') as HTMLSelectElement
    expect(amount.value).toBe('')
    expect(unit.value).toBe('seconds')
  })

  it('Undo last pick opens a reason prompt and sends audited reason on confirm', () => {
    const { onAction } = renderModal(15)
    fireEvent.click(screen.getByTestId('draft-commissioner-undo'))
    expect(screen.getByTestId('draft-commissioner-undo-prompt')).toBeTruthy()
    fireEvent.change(screen.getByTestId('draft-commissioner-undo-reason'), {
      target: { value: 'Wrong player selected' },
    })
    fireEvent.click(screen.getByTestId('draft-commissioner-undo-confirm'))
    expect(onAction).toHaveBeenCalledWith('undo_pick', { reason: 'Wrong player selected' })
  })

  it('Undo last pick requires a reason before confirmation', () => {
    const { onAction } = renderModal(15)
    fireEvent.click(screen.getByTestId('draft-commissioner-undo'))
    const confirm = screen.getByTestId('draft-commissioner-undo-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('Undo prompt cancel does not call onAction', () => {
    const { onAction } = renderModal(15)
    fireEvent.click(screen.getByTestId('draft-commissioner-undo'))
    fireEvent.click(screen.getByTestId('draft-commissioner-undo-cancel'))
    expect(onAction).not.toHaveBeenCalled()
  })

  it('preset 10s resolves to 10', async () => {
    const { onAction } = renderModal(90)
    const select = screen.getByTestId('draft-commissioner-timer-preset') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '10s' } })
    fireEvent.click(screen.getByTestId('draft-commissioner-set-timer'))
    expect(onAction).toHaveBeenCalledWith('set_timer_seconds', { seconds: 10, resetCurrentTimer: true })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { ReverseTradeDialog } from '@/components/league-trade/ReverseTradeDialog'
import type { ReversalOutcome, ReversalPreflight } from '@/lib/trade-reversal/client'

/**
 * The reversal confirmation dialog, shared by both trade engines.
 *
 * 🛑 THE PROPERTY THAT MATTERS: A TRADE THAT CANNOT BE REVERSED NEVER SHOWS A REVERSE BUTTON. Reversal
 * overwrites two rosters; letting a commissioner write a reason and press it, only to be refused, trains
 * them to stop reading the dialog.
 */

const READY: ReversalPreflight = { ok: true, readiness: { ok: true, blockers: [] } }
const BLOCKED: ReversalPreflight = {
  ok: true,
  readiness: { ok: false, blockers: ['ROSTER_CHANGED_SINCE_EXECUTION'] },
}

function mount(overrides: Partial<React.ComponentProps<typeof ReverseTradeDialog>> = {}) {
  const props = {
    title: 'Cold Takes FC ⇄ Thunderbolts',
    preflight: vi.fn(async () => READY),
    reverse: vi.fn(async (): Promise<ReversalOutcome> => ({ ok: true })),
    onClose: vi.fn(),
    onReversed: vi.fn(),
    ...overrides,
  }
  render(<ReverseTradeDialog {...props} />)
  return props
}

describe('ReverseTradeDialog', () => {
  it('🛑 shows why in plain language, and offers no reverse control, when the preflight refuses', async () => {
    mount({ preflight: vi.fn(async () => BLOCKED) })

    const blocker = await screen.findByTestId('reverse-trade-blocker')
    expect(blocker.textContent).toMatch(/rosters has changed since the trade/i)
    // The raw code is never what a commissioner reads.
    expect(blocker.textContent).not.toContain('ROSTER_CHANGED_SINCE_EXECUTION')
    expect(screen.queryByTestId('reverse-trade-confirm')).toBeNull()
    expect(screen.queryByTestId('reverse-trade-reason')).toBeNull()
  })

  it('requires a reason — whitespace does not count', async () => {
    mount()
    const confirm = await screen.findByTestId('reverse-trade-confirm')
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByTestId('reverse-trade-reason'), { target: { value: '    ' } })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByTestId('reverse-trade-reason'), { target: { value: 'collusion review' } })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends the trimmed reason, then tells the host to reload and closes', async () => {
    const props = mount()
    fireEvent.change(await screen.findByTestId('reverse-trade-reason'), { target: { value: '  collusion review  ' } })
    fireEvent.click(screen.getByTestId('reverse-trade-confirm'))

    await waitFor(() => expect(props.onReversed).toHaveBeenCalledTimes(1))
    expect(props.reverse).toHaveBeenCalledWith('collusion review')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('⚠ handles a refusal that arrives AFTER confirming the same way as a preflight refusal', async () => {
    // The preflight is advice; the server re-checks inside the transaction and can still say no.
    const props = mount({
      reverse: vi.fn(async (): Promise<ReversalOutcome> => ({
        ok: false,
        message: 'Trade cannot be reversed Nothing was changed.',
        readiness: { ok: false, blockers: ['ALREADY_REVERSED'] },
      })),
    })
    fireEvent.change(await screen.findByTestId('reverse-trade-reason'), { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('reverse-trade-confirm'))

    const blocker = await screen.findByTestId('reverse-trade-blocker')
    expect(blocker.textContent).toMatch(/already been reversed/i)
    expect(screen.queryByTestId('reverse-trade-confirm')).toBeNull()
    expect(props.onReversed).not.toHaveBeenCalled()
  })

  it('keeps the form open with the message when the reversal fails without a readiness verdict', async () => {
    const props = mount({
      reverse: vi.fn(async (): Promise<ReversalOutcome> => ({
        ok: false,
        message: 'The connection dropped before AllFantasy confirmed the result.',
        readiness: null,
      })),
    })
    fireEvent.change(await screen.findByTestId('reverse-trade-reason'), { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('reverse-trade-confirm'))

    expect((await screen.findByTestId('reverse-trade-error')).textContent).toMatch(/connection dropped/i)
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('reports a preflight it could not run, rather than showing a form', async () => {
    mount({ preflight: vi.fn(async (): Promise<ReversalPreflight> => ({ ok: false, message: 'Only a commissioner can reverse a trade.' })) })
    expect((await screen.findByTestId('reverse-trade-unavailable')).textContent).toMatch(/only a commissioner/i)
    expect(screen.queryByTestId('reverse-trade-confirm')).toBeNull()
  })

  it('shows an engine-specific caveat when the host passes one', async () => {
    mount({ note: 'Players who were locked before this trade come back unlocked.' })
    await screen.findByTestId('reverse-trade-confirm')
    expect(screen.getByText(/come back unlocked/i)).toBeTruthy()
  })

  it('closes on Escape', async () => {
    const props = mount()
    await screen.findByTestId('reverse-trade-confirm')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })
})

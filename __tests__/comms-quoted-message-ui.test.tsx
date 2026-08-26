import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuotedMessage } from '@/components/core-app/comms/QuotedMessage'

describe('QuotedMessage', () => {
  it('quotes the message being answered', () => {
    render(<QuotedMessage author="Casey" text="I'll take Kelce" />)
    expect(screen.getByText('Casey')).toBeTruthy()
    expect(screen.getByText("I'll take Kelce")).toBeTruthy()
  })

  /*
   * The panel loads the most recent 40 messages, so a reply to something older
   * points at a message the client does not hold. An empty quote would read as
   * a reply to a blank message.
   */
  it('says the parent is out of view rather than quoting nothing', () => {
    render(<QuotedMessage author={null} text={null} />)
    expect(screen.getByText('Replying to an earlier message')).toBeTruthy()
  })

  it('jumps to the parent when it is on screen', () => {
    const onJump = vi.fn()
    render(<QuotedMessage author="Casey" text="I'll take Kelce" onJump={onJump} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onJump).toHaveBeenCalled()
  })

  /* Nothing to jump to when the parent was never loaded. */
  it('offers no jump for a parent that is out of view', () => {
    render(<QuotedMessage author={null} text={null} onJump={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is not a button when no jump is offered', () => {
    render(<QuotedMessage author="Casey" text="hi" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

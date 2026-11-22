import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DraftRoomAccordion } from '@/components/app/draft-room/DraftRoomAccordion'

/**
 * The accordion's header actions (the draft copilot's Refresh, for one) used to render INSIDE the
 * toggle button. A button inside a button is invalid HTML; in development React reports it and the
 * Next.js error overlay covers the room, which is what broke the phone's Chimmy tab.
 */
describe('DraftRoomAccordion header actions', () => {
  function renderAccordion(onAction = vi.fn()) {
    render(
      <DraftRoomAccordion
        variant="redraft_snake"
        persistenceKey="test:accordion:header-actions"
        defaultOpen
        title="Draft copilot"
        headerActions={
          <button type="button" onClick={onAction}>
            Refresh
          </button>
        }
        testId="accordion"
      >
        <p>body</p>
      </DraftRoomAccordion>,
    )
    return onAction
  }

  it('renders no button inside another button', () => {
    renderAccordion()
    const root = screen.getByTestId('accordion')
    expect(root.querySelectorAll('button button')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })

  it('runs the action without toggling the section, and the title still toggles it', () => {
    const onAction = renderAccordion()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.getByText('body')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Draft copilot/ }))
    expect(screen.queryByText('body')).toBeNull()
  })
})

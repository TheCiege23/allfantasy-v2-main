import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MessageReactions } from '@/components/core-app/comms/MessageReactions'

describe('MessageReactions', () => {
  /*
   * An always-visible strip of zeroes under every message would add a line of
   * furniture to every row in the thread to say nothing.
   */
  it('shows no chips when nobody has reacted', () => {
    render(<MessageReactions reactions={[]} onToggle={() => {}} />)
    expect(screen.queryByRole('button', { pressed: false })).toBeNull()
    expect(screen.getByLabelText('Add a reaction')).toBeTruthy()
  })

  it('renders a chip with its count', () => {
    render(<MessageReactions reactions={[{ emoji: '🔥', count: 3, mine: false }]} onToggle={() => {}} />)
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('marks the viewer\u2019s own reaction as pressed', () => {
    render(<MessageReactions reactions={[{ emoji: '🔥', count: 1, mine: true }]} onToggle={() => {}} />)
    expect(screen.getByRole('button', { pressed: true })).toBeTruthy()
  })

  it('toggles when a chip is clicked', () => {
    const onToggle = vi.fn()
    render(<MessageReactions reactions={[{ emoji: '🔥', count: 1, mine: false }]} onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { pressed: false }))

    expect(onToggle).toHaveBeenCalledWith('🔥')
  })

  it('opens a picker and reacts with the chosen emoji', () => {
    const onToggle = vi.fn()
    render(<MessageReactions reactions={[]} onToggle={onToggle} />)

    fireEvent.click(screen.getByLabelText('Add a reaction'))
    const picker = screen.getByRole('group', { name: 'Pick a reaction' })
    fireEvent.click(within(picker).getByText('😂'))

    expect(onToggle).toHaveBeenCalledWith('😂')
  })

  it('closes the picker once a choice is made', () => {
    render(<MessageReactions reactions={[]} onToggle={() => {}} />)

    fireEvent.click(screen.getByLabelText('Add a reaction'))
    fireEvent.click(within(screen.getByRole('group', { name: 'Pick a reaction' })).getByText('😂'))

    expect(screen.queryByRole('group', { name: 'Pick a reaction' })).toBeNull()
  })

  /* A second tap while the first is still in flight would double-toggle. */
  it('cannot be tapped while a toggle is in flight', () => {
    const onToggle = vi.fn()
    render(
      <MessageReactions reactions={[{ emoji: '🔥', count: 1, mine: true }]} onToggle={onToggle} disabled />,
    )

    fireEvent.click(screen.getByRole('button', { pressed: true }))

    expect(onToggle).not.toHaveBeenCalled()
  })

  it('describes a chip for a screen reader', () => {
    render(<MessageReactions reactions={[{ emoji: '🔥', count: 2, mine: true }]} onToggle={() => {}} />)
    expect(screen.getByLabelText('🔥 2, including you')).toBeTruthy()
  })
})

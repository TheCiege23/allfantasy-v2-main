import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Crown, CheckCircle2 } from 'lucide-react'

import { SectionHeading, CONTEXT_ACCENT } from '@/app/dashboard/components/warroom/SectionHeading'
import { EmptyState } from '@/app/dashboard/components/warroom/EmptyState'

describe('SectionHeading (Phase 3.7)', () => {
  it('renders the label, an accent bar in the given color, and an optional icon + trailing', () => {
    const { container } = render(
      <SectionHeading accent="#22d3ee" icon={Crown} trailing={<span>3</span>}>
        My Leagues
      </SectionHeading>,
    )
    expect(container.textContent).toContain('My Leagues')
    expect(container.textContent).toContain('3')
    // Accent bar carries the color inline.
    const bar = container.querySelector('span[aria-hidden]')
    expect(bar?.getAttribute('style') || '').toContain('rgb(34, 211, 238)')
    // Icon rendered (an <svg>).
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('exposes a distinct accent per context (identity)', () => {
    expect(CONTEXT_ACCENT.global).not.toBe(CONTEXT_ACCENT.commissioner)
    expect(CONTEXT_ACCENT.commissioner).not.toBe(CONTEXT_ACCENT.team)
  })
})

describe('EmptyState (Phase 3.7)', () => {
  it('renders icon, title, description, and the premium "what unlocks" hint', () => {
    const { container } = render(
      <EmptyState
        icon={CheckCircle2}
        tone="positive"
        title="You're all caught up"
        description="No urgent decisions right now."
        hint="We'll surface anything urgent here"
      />,
    )
    expect(container.textContent).toContain("You're all caught up")
    expect(container.textContent).toContain('No urgent decisions right now.')
    expect(container.textContent).toContain("We'll surface anything urgent here")
    expect(container.querySelector('svg')).toBeTruthy()
    /*
     * Positive tone tints the title green — but with the brand hex, not
     * Tailwind's named scale. EmptyState's TONE table uses `text-[#3ddc97]` for
     * `positive` (and #7fb3ff for info), so `text-emerald-300` has not appeared
     * in this component since the palette moved to explicit values.
     */
    expect(container.innerHTML).toContain('text-[#3ddc97]')
  })

  it('omits description and hint when not provided', () => {
    const { container } = render(<EmptyState icon={CheckCircle2} title="Only a title" />)
    expect(container.textContent).toBe('Only a title')
  })
})

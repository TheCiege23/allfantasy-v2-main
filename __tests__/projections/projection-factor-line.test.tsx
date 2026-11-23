// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ProjectionFactorLine } from '@/components/projections/ProjectionFactorLine'
import { factorReason } from '@/lib/af-projections/factors/factorTables'

describe('ProjectionFactorLine', () => {
  it('shows the learner\'s own sentence for a published injury level, with the full text on hover', () => {
    const reason = factorReason({ factor: 'injury', level: 'questionable', multiplier: 0.85, games: 812, holdout: { games: 200, plainMae: 5, factorMae: 4.6 }, published: true, note: '' })
    render(<ProjectionFactorLine reasons={[reason, 'second game of a back-to-back -6% (measured on 2,400 games)']} testId="line" />)
    const line = screen.getByTestId('line')
    expect(line.textContent).toContain('listed Questionable or day-to-day before the game -15% (measured on 812 games)')
    expect(line.textContent).toContain('back-to-back')
    expect(line.getAttribute('title')).toContain(' · ')
  })

  it('renders nothing without reasons — a viewer without AF Intelligence gets none from the server', () => {
    const { container } = render(<><ProjectionFactorLine reasons={[]} /><ProjectionFactorLine reasons={undefined} /><ProjectionFactorLine reasons={['  ']} /></>)
    expect(container.innerHTML).toBe('')
  })
})

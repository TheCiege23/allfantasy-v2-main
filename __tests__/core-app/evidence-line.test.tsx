import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EvidenceLine } from '@/components/core-app/primitives'

/** The one measured "why" line every /core screen shares (owner's call, 2026-11-22). It prints what it is handed. */
describe('EvidenceLine', () => {
  it('renders nothing when there is nothing measured to say', () => {
    const { container } = render(<EvidenceLine label="Track record" lines={[null, undefined, '', '   ']} />)
    expect(container.innerHTML).toBe('')
  })

  it('one sentence: a label and the sentence verbatim, with the caller’s test id and data on the sentence', () => {
    render(<EvidenceLine label="Track record" testId="block" tone="low" lines={[{ text: 'Right 61% of the time (40 graded).', testId: 'line', data: { level: 'low', skip: undefined } }]} />)
    const line = screen.getByTestId('line')
    expect(line.tagName).toBe('P')
    expect(line.textContent).toBe('Right 61% of the time (40 graded).')
    expect(line.getAttribute('data-level')).toBe('low')
    expect(line.hasAttribute('data-skip')).toBe(false)
    const block = screen.getByTestId('block')
    expect(block.getAttribute('data-tone')).toBe('low')
    expect(block.querySelector('.af-evidence-label')!.textContent).toBe('Track record')
  })

  it('several sentences: a labelled list, in the order given, skipping the empty ones', () => {
    render(<EvidenceLine label="From real trades" listLabel="Why values moved" lines={['first', null, { text: 'second', testId: 'two' }]} />)
    const list = screen.getByRole('list', { name: 'Why values moved' })
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['first', 'second'])
    expect(screen.getByTestId('two').tagName).toBe('LI')
  })

  it('inline: spans only, so it is valid inside a sentence’s own span', () => {
    const { container } = render(<span><EvidenceLine inline label="Track record" lines={['held up']} /></span>)
    expect(container.querySelector('div, p, ul')).toBeNull()
    expect(container.querySelector('.af-evidence')!.tagName).toBe('SPAN')
    expect(container.querySelector('.af-evidence-text')!.textContent).toBe('held up')
  })
})

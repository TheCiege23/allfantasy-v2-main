import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChimmyRichText, parseChimmyBlocks } from '@/components/core-app/comms/ChimmyRichText'

const ANSWER = [
  '**Direct:** Start Jefferson.',
  '',
  '---',
  '### Why',
  '- **Matchup:** soft secondary',
  '- Target share *up* again',
  '',
  '1. Set lineup',
  '2. Recheck `injury` status',
].join('\n')

describe('ChimmyRichText — the /core drawer formats Chimmy markdown instead of printing it', () => {
  it('parses blocks', () => {
    expect(parseChimmyBlocks(ANSWER).map((b) => b.kind)).toEqual(['p', 'rule', 'heading', 'ul', 'ol'])
  })

  it('renders no literal markdown markers', () => {
    const { container } = render(<ChimmyRichText text={ANSWER} />)
    const text = container.textContent ?? ''
    expect(text).not.toContain('**')
    expect(text).not.toContain('---')
    expect(text).not.toContain('###')
    expect(container.querySelectorAll('strong').length).toBeGreaterThanOrEqual(3)
    expect(container.querySelectorAll('li').length).toBe(4)
    expect(container.querySelector('hr')).not.toBeNull()
    expect(container.querySelector('em')?.textContent).toBe('up')
    expect(container.querySelector('code')?.textContent).toBe('injury')
  })

  it('never renders model-supplied links or HTML as elements', () => {
    const { container } = render(
      <ChimmyRichText text={'See [this](https://evil.example) and <img src=x onerror=alert(1)>'} />,
    )
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('See this and <img')
  })

  it('leaves snake_case data slugs intact', () => {
    const { container } = render(<ChimmyRichText text={'Based on league_sports_grounding_packet data'} />)
    expect(container.querySelector('em')).toBeNull()
    expect(container.textContent).toBe('Based on league_sports_grounding_packet data')
  })

  it('keeps single line breaks inside a paragraph', () => {
    const { container } = render(<ChimmyRichText text={'Line one\nLine two'} />)
    expect(container.querySelectorAll('br').length).toBe(1)
  })
})

// @vitest-environment jsdom
/**
 * SuggestedActionRenderer (rendered inside every meta-aware Chimmy reply) must only ever turn INTERNAL
 * AllFantasy routes from the model's content into action buttons. An external / arbitrary URL emitted by
 * the model (prompt injection, or carried from a cached prior turn) must never become a clickable button.
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SuggestedActionRenderer } from '@/lib/chimmy-chat/SuggestedActionRenderer'

afterEach(cleanup)

describe('SuggestedActionRenderer — LLM link safety', () => {
  it('renders an internal action link as a button', () => {
    render(<SuggestedActionRenderer content={'Try [Open trade evaluator](/trade-evaluator) now.'} />)
    expect(screen.getByRole('link', { name: /open trade evaluator/i }).getAttribute('href')).toBe('/trade-evaluator')
  })

  it('drops an external LLM-supplied action link (injection ignored → no button)', () => {
    render(<SuggestedActionRenderer content={'[Set your lineup](https://evil.example/steal) right now'} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('drops a source-platform + protocol-relative URL but keeps the internal one', () => {
    render(
      <SuggestedActionRenderer
        content={'[a](//evil.example) [b](https://sleeper.com/leagues/1/league) [c](/league/x?tab=team)'}
      />,
    )
    const links = screen.queryAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/league/x?tab=team')
  })
})

// @vitest-environment jsdom
/**
 * ChimmyMessageBubble is the meta-aware renderer used by every full Chimmy surface (/ai-chat, /chimmy/chat,
 * league chat, draft room, messages). Prove that an external URL embedded in the model's own message
 * content is NOT rendered as a clickable link (its label is preserved as plain text), while an internal
 * app route stays clickable.
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ChimmyMessageBubble from '@/components/chimmy/ChimmyMessageBubble'

afterEach(cleanup)

describe('ChimmyMessageBubble — content link safety', () => {
  it('neutralizes an external link in model content (label as text, no clickable external link)', () => {
    render(
      <ChimmyMessageBubble
        role="assistant"
        content={'Click [here](https://evil.example/steal) to win.'}
        showTrustPanel={false}
        enableFollowUps={false}
      />,
    )
    expect(screen.getByText('here')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('keeps an internal app route clickable', () => {
    render(
      <ChimmyMessageBubble
        role="assistant"
        content={'Open [your league](/league/abc?tab=team).'}
        showTrustPanel={false}
        enableFollowUps={false}
      />,
    )
    const links = screen.getAllByRole('link', { name: /your league/i })
    expect(links.length).toBeGreaterThanOrEqual(1)
    for (const link of links) expect(link.getAttribute('href')).toBe('/league/abc?tab=team')
  })
})

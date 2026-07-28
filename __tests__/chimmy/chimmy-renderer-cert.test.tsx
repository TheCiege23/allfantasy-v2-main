// @vitest-environment jsdom
/**
 * Renderer certification for the shared structured renderers (drawer-compact ChimmyStructuredContent + the
 * shared ChimmyResponseMeta/ChimmyTrustPanel that the full bubble uses). Covers stale-freshness display,
 * provider/data-source attribution, text-only fallback, and safe handling of degenerate metadata.
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ChimmyStructuredContent } from '@/components/chimmy/ChimmyStructuredContent'
import type { ChimmyMessageMeta } from '@/lib/chimmy-chat/types'

afterEach(cleanup)

describe('renderer certification', () => {
  it('surfaces STALE freshness honestly from the confidence block', () => {
    const meta: ChimmyMessageMeta = {
      schemaVersion: '1',
      answerContract: { answerType: 'general', confidence: { level: 'low', freshness: 'stale' } } as never,
    }
    render(<ChimmyStructuredContent content={'Latest verified update is old.'} meta={meta} />)
    expect(screen.getByText(/stale/i)).toBeTruthy()
  })

  it('shows data-source attribution as text (never a bare clickable provider domain)', () => {
    const meta: ChimmyMessageMeta = { schemaVersion: '1', confidencePct: 55, dataSources: ['Sleeper', 'ESPN'] }
    render(<ChimmyStructuredContent content={'answer'} meta={meta} />)
    expect(screen.getByText(/Sources:/)).toBeTruthy()
    expect(screen.getByText(/Sleeper/)).toBeTruthy()
  })

  it('text-only fallback: no structured sections → renders the safe content', () => {
    const meta: ChimmyMessageMeta = { schemaVersion: '1' }
    render(<ChimmyStructuredContent content={'Just a plain answer.'} meta={meta} />)
    expect(screen.getByText(/just a plain answer/i)).toBeTruthy()
  })

  it('degenerate/empty meta renders safely (no crash, no trust panel)', () => {
    const { container } = render(<ChimmyStructuredContent content={'plain'} meta={{} as ChimmyMessageMeta} />)
    expect(container).toBeTruthy()
    expect(screen.getByText('plain')).toBeTruthy()
    expect(screen.queryByTestId('chimmy-trust-panel')).toBeNull()
  })
})

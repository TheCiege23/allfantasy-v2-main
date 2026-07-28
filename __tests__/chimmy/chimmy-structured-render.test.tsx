// @vitest-environment jsdom
/**
 * The shared structured renderers used by BOTH the dashboard drawer (ChimmyStructuredContent, compact) and
 * the full-page bubble (ChimmyResponseMeta). Proves structured sections + trust/missing-info render from the
 * validated meta, that the same URL-injection hardening applies, and that suggested actions stay internal.
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ChimmyStructuredContent } from '@/components/chimmy/ChimmyStructuredContent'
import { ChimmyResponseMeta } from '@/components/chimmy/ChimmyResponseMeta'
import type { ChimmyMessageMeta } from '@/lib/chimmy-chat/types'

afterEach(cleanup)

describe('ChimmyStructuredContent — shared compact renderer', () => {
  it('renders the structured short answer + honest missing-information from meta', () => {
    const meta: ChimmyMessageMeta = {
      schemaVersion: '1',
      confidencePct: 72,
      dataSources: ['Sleeper'],
      responseStructure: { shortAnswer: 'Start Player A tonight.', whatDataSays: 'Good matchup.', caveats: ['Weather TBD'] },
      missingInformation: ['Final injury report'],
    }
    render(<ChimmyStructuredContent content={'irrelevant raw text'} meta={meta} />)
    expect(screen.getByText(/start player a tonight/i)).toBeTruthy()
    expect(screen.getByTestId('chimmy-missing-info')).toBeTruthy()
    expect(screen.getByText(/final injury report/i)).toBeTruthy()
  })

  it('with no structured sections, renders safe content (external link neutralized, internal clickable)', () => {
    const meta: ChimmyMessageMeta = { schemaVersion: '1', confidencePct: 40 }
    render(
      <ChimmyStructuredContent
        content={'See [here](https://evil.example/x) or [your league](/league/abc?tab=team).'}
        meta={meta}
      />,
    )
    const internal = screen.getAllByRole('link', { name: /your league/i })
    expect(internal.length).toBeGreaterThanOrEqual(1)
    for (const link of internal) expect(link.getAttribute('href')).toBe('/league/abc?tab=team')
    // external label preserved as text, but never a clickable link
    expect(screen.getByText('here')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'here' })).toBeNull()
  })
})

describe('ChimmyResponseMeta — shared meta cluster', () => {
  it('renders honest missing-information', () => {
    render(<ChimmyResponseMeta content={''} meta={{ schemaVersion: '1', missingInformation: ['Kickoff weather', 'Snap counts'] }} />)
    expect(screen.getByTestId('chimmy-missing-info')).toBeTruthy()
    expect(screen.getByText(/kickoff weather/i)).toBeTruthy()
    expect(screen.getByText(/snap counts/i)).toBeTruthy()
  })

  it('suggested actions from content are internal-only (external LLM link dropped)', () => {
    render(<ChimmyResponseMeta content={'[a](https://evil.example) [b](/league/x?tab=trades)'} meta={null} />)
    const links = screen.queryAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/league/x?tab=trades')
  })

  it('renders nothing structured for null meta beyond safe suggested actions (no crash)', () => {
    const { container } = render(<ChimmyResponseMeta content={'plain text, no links'} meta={null} />)
    expect(container).toBeTruthy()
    expect(screen.queryByTestId('chimmy-missing-info')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

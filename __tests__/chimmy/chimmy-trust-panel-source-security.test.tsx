// @vitest-environment jsdom
/**
 * Source-attribution security in ChimmyTrustPanel. The server only ever emits INTERNAL AllFantasy routes
 * as source links (buildChimmySourceReferences → /league/{id}...). This proves the render layer enforces
 * that defensively: an internal route is a clickable anchor with rel="noopener noreferrer"; any external,
 * protocol-relative, scheme-based, or malformed href — from a tampered / cached / model-produced payload —
 * renders as plain TEXT with no clickable URL.
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ChimmyTrustPanel from '@/components/chimmy/ChimmyTrustPanel'

afterEach(cleanup)

function renderExpanded(sourceLinks: { label: string; href: string }[]) {
  render(
    <ChimmyTrustPanel
      confidenceBlock={{ level: 'medium', rationale: 'because the data supports it' } as never}
      sourceLinks={sourceLinks}
    />,
  )
  // source links live in the expanded "Why?" details
  fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
}

describe('ChimmyTrustPanel — source-attribution security', () => {
  it('an approved internal AllFantasy route is a clickable anchor with noopener noreferrer', () => {
    renderExpanded([{ label: 'League Home', href: '/league/L1' }])
    const link = screen.getByRole('link', { name: 'League Home' })
    expect(link.getAttribute('href')).toBe('/league/L1')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('external / protocol-relative / scheme / malformed hrefs render as TEXT, never a link', () => {
    renderExpanded([
      { label: 'League Home', href: '/league/L1' }, // internal → link
      { label: 'External', href: 'https://evil.example/x' }, // external → text
      { label: 'ProtoRel', href: '//evil.example' }, // protocol-relative → text
      { label: 'Scheme', href: 'javascript:alert(1)' }, // scheme → text
      { label: 'Malformed', href: 'not a url at all' }, // malformed → text
    ])
    // exactly one clickable source link (the internal one)
    expect(screen.getAllByTestId('chimmy-source-link')).toHaveLength(1)
    expect(screen.getAllByTestId('chimmy-source-text')).toHaveLength(4)
    // none of the untrusted labels became links
    for (const name of ['External', 'ProtoRel', 'Scheme', 'Malformed']) {
      expect(screen.queryByRole('link', { name })).toBeNull()
      expect(screen.getByText(name)).toBeTruthy() // label still shown, as text
    }
  })

  it('a model-produced external URL disguised with a friendly label is NOT clickable', () => {
    renderExpanded([{ label: 'Official Source', href: 'https://phishing.example/login' }])
    expect(screen.queryByRole('link', { name: 'Official Source' })).toBeNull()
    expect(screen.getByTestId('chimmy-source-text')).toBeTruthy()
  })
})

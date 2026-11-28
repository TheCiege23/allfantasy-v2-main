// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ImportRookieDraftQuestion } from '@/components/import/ImportRookieDraftQuestion'

afterEach(cleanup)

describe('ImportRookieDraftQuestion', () => {
  it('asks when the platform cannot say, and starts unanswered', () => {
    const onChange = vi.fn()
    render(<ImportRookieDraftQuestion season={2026} fromPlatform={null} platformLabel="MFL" value={null} onChange={onChange} />)
    expect(screen.getByText('Have you had your 2026 rookie draft?')).toBeTruthy()
    expect(screen.getByText(/MFL doesn’t say/)).toBeTruthy()
    fireEvent.click(screen.getByText('Not yet'))
    expect(onChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByText('Yes, it’s done'))
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it('tapping the chosen answer again clears it', () => {
    const onChange = vi.fn()
    render(<ImportRookieDraftQuestion season={2026} fromPlatform={null} platformLabel="ESPN" value={false} onChange={onChange} />)
    expect(screen.getByText('Not yet').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByText('Not yet'))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('asks nothing when the platform said, and states what it said', () => {
    render(<ImportRookieDraftQuestion season={2026} fromPlatform="not_done" platformLabel="Sleeper" value={null} onChange={() => {}} />)
    expect(screen.queryByText('Not yet')).toBeNull()
    expect(screen.getByTestId('import-rookie-draft-known').textContent).toContain('Sleeper says your 2026 rookie draft hasn’t happened yet')
  })
})

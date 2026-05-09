/**
 * AutopickMeToggle — Vitest / RTL
 *
 * Tests the user-facing personal auto-pick preference toggle that posts to
 * POST /api/leagues/[leagueId]/draft/autopick/me (canonical endpoint).
 * The legacy /api/draft/autopick/toggle endpoint must never be called.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutopickMeToggle, type ViewerAutopickData } from '@/components/app/draft-room/AutopickMeToggle'

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function mockFetchOk(viewerAutopick: ViewerAutopickData) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ viewerAutopick }),
  })
}

function mockFetchError(status: number, error: string) {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error }),
  })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseAutopick: ViewerAutopickData = {
  enabled: false,
  mode: 'standard',
  isProEligible: true,
  updatedAt: null,
}

const proAutopick: ViewerAutopickData = { ...baseAutopick, isProEligible: true }
const nonProAutopick: ViewerAutopickData = { ...baseAutopick, isProEligible: false }
const enabledAutopick: ViewerAutopickData = { ...baseAutopick, enabled: true, mode: 'standard' }

function renderToggle(
  viewerAutopick: ViewerAutopickData | null | undefined,
  onUpdate = vi.fn(),
) {
  render(
    <AutopickMeToggle
      viewerAutopick={viewerAutopick}
      leagueId="league-1"
      onUpdate={onUpdate}
    />,
  )
  return { onUpdate }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AutopickMeToggle — render states', () => {
  it('renders the toggle when viewerAutopick is provided', () => {
    renderToggle(baseAutopick)
    expect(screen.getByTestId('autopick-me-toggle')).toBeTruthy()
  })

  it('does not crash and renders nothing when viewerAutopick is null', () => {
    renderToggle(null)
    expect(screen.queryByTestId('autopick-me-toggle')).toBeNull()
  })

  it('does not crash and renders nothing when viewerAutopick is undefined', () => {
    renderToggle(undefined)
    expect(screen.queryByTestId('autopick-me-toggle')).toBeNull()
  })

  it('checkbox is unchecked when enabled=false', () => {
    renderToggle(baseAutopick)
    const checkbox = screen.getByTestId('autopick-me-enabled') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
  })

  it('checkbox is checked when enabled=true', () => {
    renderToggle(enabledAutopick)
    const checkbox = screen.getByTestId('autopick-me-enabled') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('mode buttons are not shown when disabled', () => {
    renderToggle(baseAutopick) // enabled=false
    expect(screen.queryByTestId('autopick-mode-standard')).toBeNull()
    expect(screen.queryByTestId('autopick-mode-ai-queue')).toBeNull()
  })

  it('mode buttons appear when enabled=true', () => {
    renderToggle(enabledAutopick)
    expect(screen.getByTestId('autopick-mode-standard')).toBeTruthy()
    expect(screen.getByTestId('autopick-mode-ai-queue')).toBeTruthy()
  })
})

describe('AutopickMeToggle — toggling enabled', () => {
  it('toggling on posts { enabled: true, mode: "standard" } by default', async () => {
    mockFetchOk({ ...baseAutopick, enabled: true })
    renderToggle(baseAutopick)
    fireEvent.click(screen.getByTestId('autopick-me-enabled'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/leagues/league-1/draft/autopick/me')
    expect(JSON.parse(opts.body as string)).toEqual({ enabled: true, mode: 'standard' })
  })

  it('toggling off posts { enabled: false, mode: "standard" }', async () => {
    mockFetchOk({ ...enabledAutopick, enabled: false })
    renderToggle(enabledAutopick)
    fireEvent.click(screen.getByTestId('autopick-me-enabled'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({ enabled: false, mode: 'standard' })
  })

  it('never calls the legacy /api/draft/autopick/toggle endpoint', async () => {
    mockFetchOk({ ...baseAutopick, enabled: true })
    renderToggle(baseAutopick)
    fireEvent.click(screen.getByTestId('autopick-me-enabled'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain('/api/draft/autopick/toggle')
    expect(url).toContain('/api/leagues/')
  })
})

describe('AutopickMeToggle — mode selection', () => {
  it('clicking Standard posts { enabled: true, mode: "standard" }', async () => {
    const aiQueueEnabled: ViewerAutopickData = {
      ...enabledAutopick,
      mode: 'ai_queue',
      isProEligible: true,
    }
    mockFetchOk({ ...aiQueueEnabled, mode: 'standard' })
    renderToggle(aiQueueEnabled)
    fireEvent.click(screen.getByTestId('autopick-mode-standard'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({ enabled: true, mode: 'standard' })
  })

  it('ai_queue button is visually locked for non-Pro users (aria-disabled + opacity class)', () => {
    renderToggle({ ...enabledAutopick, isProEligible: false })
    const aiBtn = screen.getByTestId('autopick-mode-ai-queue') as HTMLButtonElement
    expect(aiBtn.getAttribute('aria-disabled')).toBe('true')
    expect(aiBtn.className).toMatch(/opacity-45/)
  })

  it('clicking ai_queue when non-Pro shows inline error and does not call fetch', async () => {
    renderToggle({ ...enabledAutopick, isProEligible: false })
    fireEvent.click(screen.getByTestId('autopick-mode-ai-queue'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('autopick-me-error').textContent).toMatch(/AF Pro/i)
  })

  it('clicking ai_queue for Pro user posts { enabled: true, mode: "ai_queue" }', async () => {
    mockFetchOk({ ...enabledAutopick, mode: 'ai_queue', isProEligible: true })
    renderToggle({ ...enabledAutopick, isProEligible: true })
    fireEvent.click(screen.getByTestId('autopick-mode-ai-queue'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({ enabled: true, mode: 'ai_queue' })
  })
})

describe('AutopickMeToggle — success response', () => {
  it('calls onUpdate with server-returned viewerAutopick after success', async () => {
    const updated: ViewerAutopickData = { enabled: true, mode: 'standard', isProEligible: true, updatedAt: '2026-01-01T00:00:00Z' }
    mockFetchOk(updated)
    const onUpdate = vi.fn()
    renderToggle(baseAutopick, onUpdate)
    fireEvent.click(screen.getByTestId('autopick-me-enabled'))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(onUpdate).toHaveBeenCalledWith(updated)
  })

  it('updates local checkbox state to reflect server response', async () => {
    mockFetchOk({ ...baseAutopick, enabled: true })
    renderToggle(baseAutopick)
    const checkbox = screen.getByTestId('autopick-me-enabled') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    await waitFor(() => expect(checkbox.checked).toBe(true))
  })
})

describe('AutopickMeToggle — failure handling', () => {
  it('shows inline error when API returns non-ok response', async () => {
    mockFetchError(500, 'Internal Server Error')
    renderToggle(baseAutopick)
    fireEvent.click(screen.getByTestId('autopick-me-enabled'))
    await waitFor(() => expect(screen.getByTestId('autopick-me-error')).toBeTruthy())
  })

  it('shows AF Pro required message on 403', async () => {
    mockFetchError(403, 'AF Pro required to enable AI queue auto-pick.')
    renderToggle(baseAutopick)
    fireEvent.click(screen.getByTestId('autopick-me-enabled'))
    await waitFor(() =>
      expect(screen.getByTestId('autopick-me-error').textContent).toMatch(/AF Pro/i),
    )
  })

  it('rolls back checkbox to previous state on failure', async () => {
    mockFetchError(500, 'Server error')
    renderToggle(baseAutopick) // starts disabled
    const checkbox = screen.getByTestId('autopick-me-enabled') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox) // optimistically checked
    await waitFor(() => expect(screen.getByTestId('autopick-me-error')).toBeTruthy())
    // Should have rolled back to false
    expect(checkbox.checked).toBe(false)
  })

  it('does not call onUpdate when save fails', async () => {
    mockFetchError(500, 'Server error')
    const onUpdate = vi.fn()
    renderToggle(baseAutopick, onUpdate)
    fireEvent.click(screen.getByTestId('autopick-me-enabled'))
    await waitFor(() => expect(screen.getByTestId('autopick-me-error')).toBeTruthy())
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe('AutopickMeToggle — source invariants', () => {
  it('never imports or references the legacy autopick toggle endpoint', () => {
    const { readFileSync } = require('node:fs')
    const { resolve } = require('node:path')
    const src = readFileSync(
      resolve(__dirname, '../../components/app/draft-room/AutopickMeToggle.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/\/api\/draft\/autopick\/toggle/)
    expect(src).toMatch(/\/api\/leagues\//)
  })

  it('DraftRoomPageClient mounts AutopickMeToggle and wires viewerAutopick', () => {
    const { readFileSync } = require('node:fs')
    const { resolve } = require('node:path')
    const src = readFileSync(
      resolve(__dirname, '../../components/app/draft-room/DraftRoomPageClient.tsx'),
      'utf8',
    )
    expect(src).toMatch(/AutopickMeToggle/)
    expect(src).toMatch(/viewerAutopick=\{session\.viewerAutopick\}/)
    expect(src).toMatch(/handleAutopickMeUpdate/)
  })

  it('handleAutopickMeUpdate updates session.viewerAutopick via setSession', () => {
    const { readFileSync } = require('node:fs')
    const { resolve } = require('node:path')
    const src = readFileSync(
      resolve(__dirname, '../../components/app/draft-room/DraftRoomPageClient.tsx'),
      'utf8',
    )
    expect(src).toMatch(/viewerAutopick: updated/)
  })
})

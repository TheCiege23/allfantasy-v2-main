// @vitest-environment jsdom
/** The welcome-back summary (phase 13): what AllFantasy did while it ran a team, from the logs. */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  roster: vi.fn(),
  ended: vi.fn(),
  changes: vi.fn(),
  claims: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findFirst: m.roster },
    leagueAuditLog: { findFirst: m.ended, findMany: m.claims },
    automationAuditLog: { findMany: m.changes },
  },
}))

import { welcomeBackSummary } from '@/lib/inactive-manager/welcomeBack'
import { readWelcomeBack } from '@/lib/inactive-manager/welcomeBackService'
import { WelcomeBackCard } from '@/components/league/WelcomeBackCard'

const SINCE = new Date('2026-10-01T00:00:00Z')
const ENDED = new Date('2026-10-15T00:00:00Z')
const NOW = new Date('2026-10-16T00:00:00Z')

describe('welcomeBackSummary', () => {
  it('counts lineup changes and claims, newest first, in both languages', () => {
    const s = welcomeBackSummary({
      since: SINCE,
      endedAt: ENDED,
      autopilot: true,
      lineupChanges: [
        { at: new Date('2026-10-03T00:00:00Z'), message: 'Set the best lineup.' },
        { at: new Date('2026-10-10T00:00:00Z'), message: 'Benched a bye.' },
      ],
      claims: [{ at: new Date('2026-10-05T00:00:00Z'), add: 'New Back', drop: 'Old Back' }],
    })
    expect(s).toMatchObject({ days: 14, lineupChanges: 2, claims: 1 })
    expect(s.en.headline).toBe('Welcome back. In the 14 days you were away, Chimmy autopilot set your lineup 2 times and made 1 waiver claim.')
    expect(s.en.lines).toEqual(['Benched a bye.', 'Waiver claim: add New Back, drop Old Back.', 'Set the best lineup.'])
    expect(s.en.claimsNote).toMatch(/Waivers tab/)
    expect(s.es.headline).toBe('Hola de nuevo. En los 14 días que estuviste fuera, el piloto automático de Chimmy ajustó tu alineación 2 veces y hizo 1 reclamo.')
  })

  it('says so plainly when nothing needed changing', () => {
    const s = welcomeBackSummary({ since: SINCE, endedAt: ENDED, autopilot: false, lineupChanges: [], claims: [] })
    expect(s.en.headline).toBe('Welcome back. AllFantasy ran your team for 14 days and did not need to change anything.')
    expect(s.en.claimsNote).toBeNull()
    expect(s.es.headline).toBe('Hola de nuevo. AllFantasy llevó tu equipo durante 14 días y no tuvo que cambiar nada.')
  })
})

describe('readWelcomeBack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.roster.mockResolvedValue({ id: 'r1' })
    m.ended.mockResolvedValue({ id: 'e1', createdAt: ENDED, metadata: { since: SINCE.toISOString(), autopilot: false } })
    m.changes.mockResolvedValue([{ createdAt: new Date('2026-10-03T00:00:00Z'), message: 'Set the best lineup.' }])
    m.claims.mockResolvedValue([])
  })

  it('reads only the time the team was being run', async () => {
    const v = await readWelcomeBack('L', 'owner', NOW)
    expect(v).toMatchObject({ id: 'e1', summary: { lineupChanges: 1, claims: 0 } })
    expect(m.changes).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ entityId: 'r1', createdAt: { gte: SINCE, lte: ENDED } }) }))
  })

  it('is nothing for someone with no team, no recent return, or a return logged before phase 13', async () => {
    m.roster.mockResolvedValueOnce(null)
    expect(await readWelcomeBack('L', 'stranger', NOW)).toBeNull()
    m.ended.mockResolvedValueOnce(null)
    expect(await readWelcomeBack('L', 'owner', NOW)).toBeNull()
    m.ended.mockResolvedValueOnce({ id: 'e0', createdAt: ENDED, metadata: { reason: 'owner_saved_lineup' } })
    expect(await readWelcomeBack('L', 'owner', NOW)).toBeNull()
  })
})

describe('WelcomeBackCard', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('shows the summary once, and stays hidden after Got it', async () => {
    const summary = welcomeBackSummary({ since: SINCE, endedAt: ENDED, autopilot: false, lineupChanges: [{ at: ENDED, message: 'Set the best lineup.' }], claims: [] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ welcomeBack: { id: 'e1', endedAt: ENDED.toISOString(), summary } }), { status: 200 })))
    const first = render(<WelcomeBackCard leagueId="L" />)
    expect(await screen.findByText(summary.en.headline)).toBeInTheDocument()
    expect(screen.getByText('Set the best lineup.')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('welcome-back-dismiss'))
    expect(screen.queryByTestId('welcome-back')).toBeNull()
    first.unmount()
    render(<WelcomeBackCard leagueId="L" />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('welcome-back')).toBeNull()
  })
})

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ session: { user: { id: 'comm' } } as { user: { id: string } } | null, requireRole: vi.fn(), read: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: m.requireRole }))
vi.mock('@/lib/commissioner/weeklyChecklistService', () => ({ readWeeklyChecklist: m.read }))

import { GET } from '@/app/api/commissioner/leagues/[leagueId]/weekly-checklist/route'
import { WeeklyChecklist } from '@/components/core-app/commissioner/WeeklyChecklist'

const ctx = { params: Promise.resolve({ leagueId: 'L' }) }
const req = () => new NextRequest('http://x/api/commissioner/leagues/L/weekly-checklist')
const item = (id: string, status: string, en: string, es: string) => ({ id, status, title: { en, es }, detail: { en: `${en} detail`, es: `${es} detalle` }, href: `/core/x?league=L#${id}` })

beforeEach(() => {
  vi.clearAllMocks()
  m.session = { user: { id: 'comm' } }
  m.requireRole.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GET weekly-checklist', () => {
  it('commissioners only: signed out 401, members refused, the service never reached', async () => {
    m.session = null
    expect((await GET(req(), ctx)).status).toBe(401)
    m.session = { user: { id: 'member' } }
    m.requireRole.mockRejectedValue(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))
    expect((await GET(req(), ctx)).status).toBe(403)
    expect(m.read).not.toHaveBeenCalled()
  })

  it('returns the view, or 404 for an unknown league', async () => {
    m.read.mockResolvedValue({ applies: false, reason: 'not_redraft' })
    expect(await (await GET(req(), ctx)).json()).toEqual({ applies: false, reason: 'not_redraft' })
    m.read.mockResolvedValue(null)
    expect((await GET(req(), ctx)).status).toBe(404)
  })
})

describe('WeeklyChecklist card', () => {
  const stub = (body: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })))

  it('shows the week, a to-do count, and each item linked to where it is fixed', async () => {
    stub({ applies: true, week: 7, items: [item('scores', 'done', 'Week 6 scores are final', 'Puntuación definitiva'), item('lineups', 'todo', '2 teams need a lineup fix', 'Arreglar alineaciones')] })
    const r = render(<WeeklyChecklist leagueId="L" />)
    await waitFor(() => expect(r.getAllByTestId('weekly-checklist-item')).toHaveLength(2))
    expect(r.getByText('This week · week 7')).toBeTruthy()
    expect(r.getByText('1 to do')).toBeTruthy()
    expect(r.getByRole('link', { name: '2 teams need a lineup fix' }).getAttribute('href')).toBe('/core/x?league=L#lineups')
    expect(r.getAllByTestId('weekly-checklist-item')[1].getAttribute('data-status')).toBe('todo')
  })

  it('speaks Spanish in Spanish, and says "all caught up" when nothing is to do', async () => {
    stub({ applies: true, week: 3, items: [item('trades', 'done', 'No trades', 'Ningún intercambio espera por ti')] })
    const r = render(<WeeklyChecklist leagueId="L" language="es" />)
    await r.findByText('Ningún intercambio espera por ti')
    expect(r.getByText('Esta semana · semana 3')).toBeTruthy()
    expect(r.getByText('Todo al día')).toBeTruthy()
  })

  it('renders nothing for a league it does not cover, or when the read fails', async () => {
    stub({ applies: false, reason: 'not_redraft' })
    const a = render(<WeeklyChecklist leagueId="L" />)
    await waitFor(() => expect(a.queryByTestId('weekly-checklist')).toBeNull())
    cleanup()
    stub({ error: 'x' }, false)
    const b = render(<WeeklyChecklist leagueId="L" />)
    await waitFor(() => expect(b.queryByTestId('weekly-checklist')).toBeNull())
  })
})

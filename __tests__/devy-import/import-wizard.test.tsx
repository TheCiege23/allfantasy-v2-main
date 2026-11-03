/**
 * Devy import wizard, end to end against a mocked fetch: each step loads the real route's shape,
 * submits what the route expects, and renders in English and Spanish.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es', gate: vi.fn(async () => true) }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[h.language]?.[k] ?? dict.en[k] ?? k
  return { useOptionalLanguage: () => ({ language: h.language, t }) }
})
vi.mock('@/hooks/useAfSubGate', () => ({ useAfSubGate: () => ({ handleApiResponse: h.gate }) }))

import { ImportWizard } from '@/app/devy/components/ImportWizard'

type Call = { method: string; path: string; body: Record<string, unknown> | null }
type Handler = (call: Call) => { status?: number; json: unknown } | undefined

let calls: Call[] = []
let handler: Handler = () => undefined

function installFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname + url.search,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    }
    calls.push(call)
    const res = handler(call) ?? { status: 500, json: { error: `unhandled ${call.method} ${call.path}` } }
    return new Response(JSON.stringify(res.json), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

const player = (id: string, o: Record<string, unknown> = {}) => ({
  id, externalId: `x${id}`, externalName: `Player ${id}`, externalPlatform: 'sleeper', externalPosition: 'RB', externalTeam: 'ATL',
  externalSchool: null, internalPlayerId: `ip${id}`, internalPlayerName: `Internal ${id}`, matchConfidence: 'exact', matchMethod: 'id_lookup',
  isConfirmedByCommissioner: false, requiresReview: false, playerType: 'nfl_veteran', ...o,
})
const manager = (id: string, o: Record<string, unknown> = {}) => ({
  id, externalUsername: `ext${id}`, externalDisplayName: `Ext ${id}`, externalPlatform: 'sleeper', internalUserId: `u${id}`,
  internalUsername: `User ${id}`, matchConfidence: 'exact', isConfirmedByCommissioner: false, requiresReview: false, ...o,
})
const source = (o: Record<string, unknown> = {}) => ({
  id: 'src1', sourceType: 'league_id_entry', sourcePlatform: 'sleeper', classification: 'nfl_roster', connectionStatus: 'connected',
  importedAt: null, createdAt: '2026-10-01T00:00:00Z', playerCount: 14, managerCount: 2, season: 2025, hasError: false, ...o,
})
const sess = (status: string) => ({ session: { id: 'S1', leagueId: 'L1', status, mergedAt: status === 'merged' ? '2026-10-02T00:00:00Z' : null } })

beforeEach(() => {
  calls = []
  h.language = 'en'
  h.gate.mockClear()
  installFetch()
})
afterEach(() => cleanup())

const writes = () => calls.filter(c => c.method !== 'GET')

describe('step 1 — sources', () => {
  it('starts a session, then adds a Sleeper league with the body the sources route expects', async () => {
    handler = ({ method, path }) => {
      if (method === 'POST' && path === '/api/devy/import') return { json: sess('pending') }
      if (method === 'GET' && path === '/api/devy/import/sources?sessionId=S1') return { json: { sources: [] } }
      if (method === 'POST' && path === '/api/devy/import/sources') return { json: { source: source() } }
      return undefined
    }
    render(<ImportWizard leagueId="L1" />)
    fireEvent.click(screen.getByTestId('import-start-session'))
    await screen.findByTestId('import-sources-empty')
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/devy/import', body: { leagueId: 'L1' } })
    expect(window.location.search).toContain('sessionId=S1')

    // Matching needs a connected source first.
    expect(screen.getByTestId('import-run-matching')).toBeDisabled()
    fireEvent.change(screen.getByTestId('import-sleeper-league-id'), { target: { value: '1234567890' } })
    fireEvent.click(screen.getByTestId('import-add-source-submit'))
    expect(await screen.findByTestId('import-add-result')).toHaveTextContent('Source added with 14 players.')
    expect(writes()[1]).toMatchObject({
      body: { sessionId: 'S1', sourceType: 'league_id_entry', platform: 'sleeper', classification: 'nfl_roster', data: { leagueId: '1234567890' } },
    })
    expect(screen.getByTestId('import-source-src1')).toHaveTextContent('14 players · 2 managers · Season 2025')
    expect(screen.getByTestId('import-run-matching')).toBeEnabled()
  })

  it('sends a pasted CSV as csv_upload and runs matching into step 2', async () => {
    window.history.replaceState(null, '', '/')
    handler = ({ method, path }) => {
      if (method === 'GET' && path === '/api/devy/import?sessionId=S1') return { json: sess('classified') }
      if (method === 'GET' && path === '/api/devy/import/sources?sessionId=S1') return { json: { sources: [] } }
      if (method === 'POST' && path === '/api/devy/import/sources') return { json: { source: source({ id: 'src2', sourceType: 'csv_upload', sourcePlatform: 'csv', season: null, managerCount: 0 }) } }
      if (method === 'POST' && path === '/api/devy/import/match') return { json: { ok: true } }
      if (method === 'GET' && path === '/api/devy/import/match?sessionId=S1') return { json: { players: [player('1')], managers: [], conflicts: [], leagueManagers: [] } }
      return undefined
    }
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    await screen.findByTestId('import-sources-empty')
    fireEvent.click(screen.getByTestId('import-kind-csv'))
    fireEvent.change(screen.getByTestId('import-csv-text'), { target: { value: 'name,owner\nA,bob' } })
    fireEvent.click(screen.getByTestId('import-add-source-submit'))
    await screen.findByTestId('import-source-src2')
    expect(writes()[0]).toMatchObject({ body: { sourceType: 'csv_upload', platform: 'csv', data: { csvText: 'name,owner\nA,bob' } } })
    fireEvent.click(screen.getByTestId('import-run-matching'))
    await screen.findByTestId('import-step-matching')
    expect(writes()[1]).toMatchObject({ path: '/api/devy/import/match', body: { sessionId: 'S1', action: 'run_matching' } })
  })

  it('shows the commissioner-only error when the route refuses to start a session', async () => {
    h.language = 'es'
    handler = () => ({ status: 403, json: { error: 'Forbidden' } })
    render(<ImportWizard leagueId="L1" />)
    expect(screen.getByTestId('import-start-session')).toHaveTextContent('Empezar importación')
    fireEvent.click(screen.getByTestId('import-start-session'))
    expect(await screen.findByTestId('import-error')).toHaveTextContent('Solo el comisionado de la liga puede hacer esto.')
  })
})

describe('step 2 — matching review', () => {
  const base = () => ({
    players: [
      player('1'),
      player('2', { matchConfidence: 'high', matchMethod: 'name_exact' }),
      player('3', { internalPlayerId: null, internalPlayerName: null, matchConfidence: 'low', requiresReview: true }),
    ],
    managers: [manager('a'), manager('b', { internalUserId: null, internalUsername: null, matchConfidence: 'unmatched', requiresReview: true })],
    conflicts: [],
    leagueManagers: [{ userId: 'uz', label: 'Zed' }],
  })

  function route(payload = base()) {
    handler = ({ method, path, body }) => {
      if (method === 'GET' && path === '/api/devy/import?sessionId=S1') return { json: sess('matching') }
      if (method === 'GET' && path === '/api/devy/import/match?sessionId=S1') return { json: payload }
      if (method === 'PATCH' && path === '/api/devy/import/mappings') {
        if (body?.kind === 'manager') {
          return { json: { ok: true, managerMapping: { ...manager(String(body.mappingId).slice(0)), id: body.mappingId, internalUserId: body.internalUserId ?? null, internalUsername: body.internalUsername ?? null, isConfirmedByCommissioner: true, requiresReview: false } } }
        }
        const prev = payload.players.find(p => p.id === body?.mappingId)!
        return {
          json: {
            ok: true,
            playerMapping: {
              ...prev,
              isConfirmedByCommissioner: body?.action === 'confirm',
              requiresReview: body?.action === 'reject',
              internalPlayerId: (body?.internalPlayerId as string) ?? prev.internalPlayerId,
              internalPlayerName: (body?.internalPlayerName as string) ?? prev.internalPlayerName,
            },
          },
        }
      }
      if (method === 'POST' && path === '/api/devy/ai') {
        return { json: { suggestions: [{ mappingId: '3', externalName: 'Player 3', suggestedPlayerId: 'ip9', suggestedName: 'Nine Name', confidence: 85, reason: 'x' }] } }
      }
      return undefined
    }
  }

  it('opens on the matching step for a session in matching, with real counts', async () => {
    route()
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    await screen.findByTestId('import-step-matching')
    expect(screen.getByTestId('import-count-exact')).toHaveTextContent('1')
    expect(screen.getByTestId('import-count-high')).toHaveTextContent('1')
    expect(screen.getByTestId('import-count-unmatched')).toHaveTextContent('1')
    expect(screen.getByTestId('import-ready-summary')).toHaveTextContent('1 players are ready to import. 2 need your review.')
    // The exact match is ready and not in the review list.
    expect(screen.queryByTestId('import-player-1')).toBeNull()
  })

  it('confirming a high match PATCHes confirm and moves it out of review', async () => {
    route()
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    fireEvent.click(await screen.findByTestId('import-player-confirm-2'))
    await waitFor(() => expect(screen.queryByTestId('import-player-2')).toBeNull())
    expect(writes()[0]).toMatchObject({ method: 'PATCH', body: { sessionId: 'S1', mappingId: '2', kind: 'player', action: 'confirm' } })
    expect(writes()[0]!.body).not.toHaveProperty('internalPlayerId')
  })

  it("Chimmy's suggestion fills an unmatched row and Use sends its player id and name", async () => {
    route()
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    fireEvent.click(await screen.findByTestId('import-ask-chimmy'))
    expect(await screen.findByTestId('import-suggestion-3')).toHaveTextContent('Chimmy suggests Nine Name (85% name match)')
    expect(calls.find(c => c.path === '/api/devy/ai')?.body).toEqual({ action: 'suggest_matches', sessionId: 'S1' })
    fireEvent.click(screen.getByTestId('import-player-use-suggestion-3'))
    await waitFor(() => expect(screen.queryByTestId('import-player-3')).toBeNull())
    expect(writes().at(-1)).toMatchObject({ body: { mappingId: '3', action: 'confirm', internalPlayerId: 'ip9', internalPlayerName: 'Nine Name' } })
  })

  it('links an unmatched manager to a league manager', async () => {
    route()
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    const row = await screen.findByTestId('import-manager-b')
    expect(row).toHaveTextContent('Needs a link')
    expect(screen.getByTestId('import-manager-link-b')).toBeDisabled()
    fireEvent.change(screen.getByTestId('import-manager-select-b'), { target: { value: 'uz' } })
    fireEvent.click(screen.getByTestId('import-manager-link-b'))
    await waitFor(() => expect(screen.getByTestId('import-manager-b')).toHaveTextContent('Linked to Zed'))
    expect(writes()[0]).toMatchObject({ body: { mappingId: 'b', kind: 'manager', action: 'confirm', internalUserId: 'uz', internalUsername: 'Zed' } })
  })

  it('matching again needs a second tap before it wipes the reviews', async () => {
    route()
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    const btn = await screen.findByTestId('import-rerun-matching')
    fireEvent.click(btn)
    expect(writes()).toHaveLength(0)
    expect(btn).toHaveAttribute('data-armed', 'true')
    fireEvent.click(screen.getByTestId('import-rerun-matching-cancel'))
    expect(btn).toHaveAttribute('data-armed', 'false')
    expect(writes()).toHaveLength(0)
  })

  it('renders in Spanish', async () => {
    h.language = 'es'
    route()
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    const step = await screen.findByTestId('import-step-matching')
    expect(screen.getByTestId('import-ready-summary')).toHaveTextContent('1 jugadores están listos para importar. 2 necesitan tu revisión.')
    expect(screen.getByTestId('import-manager-b')).toHaveTextContent('Falta vincular')
    expect(screen.getByTestId('import-step-1')).toHaveTextContent('Revisión de coincidencias')
    expect(step.textContent).not.toMatch(/devyImport\./)
  })

  it('shows an empty state when the sources held nobody', async () => {
    route({ players: [], managers: [], conflicts: [], leagueManagers: [] })
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    expect(await screen.findByTestId('import-matching-empty')).toBeInTheDocument()
  })
})

describe('step 3 — conflicts', () => {
  it('saves a decision with its note and removes the card', async () => {
    handler = ({ method, path }) => {
      if (method === 'GET' && path === '/api/devy/import?sessionId=S1') return { json: sess('conflict_review') }
      if (method === 'GET' && path === '/api/devy/import/conflicts?sessionId=S1') {
        return { json: { conflicts: [{ id: 'c1', conflictType: 'username_mismatch', description: 'Manager Bob could not be matched', resolution: 'pending' }] } }
      }
      if (method === 'PATCH' && path === '/api/devy/import/conflicts') return { json: { ok: true } }
      return undefined
    }
    h.language = 'es'
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    const card = await screen.findByTestId('import-conflict-c1')
    expect(card).toHaveTextContent('Mánager sin vincular')
    expect(screen.getByTestId('import-conflicts-remaining')).toHaveTextContent('Quedan 1 conflictos')
    expect(screen.getByTestId('import-conflict-save-c1')).toBeDisabled()
    fireEvent.click(screen.getByTestId('import-conflict-c1-skipped'))
    fireEvent.change(screen.getByTestId('import-conflict-note-c1'), { target: { value: ' left the league ' } })
    fireEvent.click(screen.getByTestId('import-conflict-save-c1'))
    expect(await screen.findByTestId('import-conflicts-empty')).toHaveTextContent('Todos los conflictos resueltos (1 en esta visita).')
    expect(writes()[0]).toMatchObject({ method: 'PATCH', body: { conflictId: 'c1', resolution: 'skipped', note: 'left the league' } })
  })
})

describe('step 4 — pre-merge review and execute', () => {
  function route(opts: { conflicts?: unknown[]; result?: unknown; statusAfter?: string } = {}) {
    let merged = false
    handler = ({ method, path }) => {
      if (method === 'GET' && path === '/api/devy/import?sessionId=S1') return { json: sess(merged ? (opts.statusAfter ?? 'merged') : 'approved') }
      if (method === 'GET' && path === '/api/devy/import/match?sessionId=S1') {
        return { json: { players: [player('1'), player('2', { playerType: 'devy', isConfirmedByCommissioner: true, matchConfidence: 'medium' }), player('3', { matchConfidence: 'high' })], managers: [manager('a')], conflicts: [], leagueManagers: [] } }
      }
      if (method === 'GET' && path === '/api/devy/import/sources?sessionId=S1') return { json: { sources: [source()] } }
      if (method === 'GET' && path === '/api/devy/import/conflicts?sessionId=S1') return { json: { conflicts: opts.conflicts ?? [] } }
      if (method === 'POST' && path === '/api/devy/import/execute') {
        merged = true
        return { json: { result: opts.result ?? { ok: true, playersWritten: 2, seasonsWritten: 1, picksWritten: 0, errors: [] } } }
      }
      return undefined
    }
  }

  it('shows what will change and needs two taps to merge', async () => {
    route()
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    await screen.findByTestId('import-step-premerge')
    expect(screen.getByTestId('import-premerge-nfl')).toHaveTextContent('Add 1 NFL players')
    expect(screen.getByTestId('import-premerge-devy')).toHaveTextContent('Add 1 devy prospects')
    expect(screen.getByTestId('import-premerge-seasons')).toHaveTextContent('Record 1 history seasons (2025)')
    expect(screen.getByTestId('import-premerge-skipped')).toHaveTextContent('Skip 1 players: 1 not confirmed, 0 with no match')
    const btn = screen.getByTestId('import-execute')
    fireEvent.click(btn)
    expect(calls.some(c => c.path === '/api/devy/import/execute')).toBe(false)
    expect(btn).toHaveTextContent('Tap again to write 2 players to rosters')
    fireEvent.click(btn)
    expect(await screen.findByTestId('import-execute-result')).toHaveTextContent('Merged: 2 players and 1 history seasons.')
    expect(calls.filter(c => c.path === '/api/devy/import/execute')).toEqual([{ method: 'POST', path: '/api/devy/import/execute', body: { sessionId: 'S1' } }])
  })

  it('cannot merge while a conflict is pending, and links to the conflicts step', async () => {
    route({ conflicts: [{ id: 'c1', conflictType: 'duplicate_player', description: 'd', resolution: 'pending' }] })
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    expect(await screen.findByTestId('import-premerge-blockers')).toHaveTextContent('Resolve 1 conflicts')
    expect(screen.getByTestId('import-execute')).toBeDisabled()
  })

  it('shows a refused merge as "nothing changed" with the engine reason in Spanish', async () => {
    h.language = 'es'
    route({ result: { ok: false, playersWritten: 0, seasonsWritten: 0, picksWritten: 0, errors: ['No RedraftSeason for league — create a season before merge'] }, statusAfter: 'approved' })
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    const btn = await screen.findByTestId('import-execute')
    fireEvent.click(btn)
    fireEvent.click(btn)
    const res = await screen.findByTestId('import-execute-result')
    expect(res).toHaveTextContent('La combinación no se hizo. Nada cambió en tu liga.')
    expect(within(res).getByTestId('import-execute-errors')).toHaveTextContent('Esta liga todavía no tiene temporada.')
  })

  it('a merge that skipped players says so and lists them', async () => {
    route({ result: { ok: false, playersWritten: 1, seasonsWritten: 0, picksWritten: 0, errors: ['No manager mapping for Player 2 (external roster owner bob)'] } })
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    const btn = await screen.findByTestId('import-execute')
    fireEvent.click(btn)
    fireEvent.click(btn)
    const res = await screen.findByTestId('import-execute-result')
    expect(res).toHaveTextContent('Merged with gaps: 1 players and 0 history seasons.')
    expect(res).toHaveTextContent('Player 2: their manager (bob) is not linked.')
  })
})

describe('step 5 — audit', () => {
  const audit = {
    playersImported: 12, unmatchedPlayers: [{ id: 'm9', name: 'Nobody Known' }], conflictsResolved: 2, conflictsPending: 0, managersMatched: 10,
    managersUnmatched: [], historySeasonsImported: 3, picksImported: 40, missingImages: [], missingSchoolLogos: [], dataConfidenceScore: 'medium',
    notes: ['Some players could not be matched automatically.'],
  }
  function route() {
    handler = ({ method, path }) => {
      if (method === 'GET' && path === '/api/devy/import?sessionId=S1') return { json: sess('merged') }
      if (method === 'GET' && path === '/api/devy/import/audit?sessionId=S1') return { json: { audit, session: { id: 'S1', status: 'merged', mergedAt: '2026-10-02T00:00:00Z', summary: null } } }
      if (method === 'POST' && path === '/api/devy/ai') return { json: { narrative: 'Twelve players came across.', auditConfidence: 'medium' } }
      return undefined
    }
  }

  it.each([
    ['en', '✓ Merge complete', 'Players matched: 12', 'Some players could not be matched automatically.'],
    ['es', '✓ Combinación terminada', 'Jugadores emparejados: 12', 'Algunos jugadores no se pudieron emparejar automáticamente.'],
  ] as const)('a merged session opens on the audit (%s)', async (lang, title, players, note) => {
    h.language = lang
    route()
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    expect(await screen.findByTestId('import-audit-merged')).toHaveTextContent(title)
    expect(screen.getByTestId('import-audit-players')).toHaveTextContent(players)
    expect(screen.getByTestId('import-audit-unmatched')).toHaveTextContent('Nobody Known')
    expect(screen.getByTestId('import-audit-notes')).toHaveTextContent(note)
    expect(screen.getByTestId('import-step-audit').textContent).not.toMatch(/devyImport\./)
  })

  it('downloads the plain-text audit built by formatImportAuditPlainText', async () => {
    route()
    const created: Blob[] = []
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b)
      return 'blob:x'
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    fireEvent.click(await screen.findByTestId('import-audit-download'))
    expect(click).toHaveBeenCalledTimes(1)
    const text = await created[0]!.text()
    expect(text).toContain('ALLFANTASY — DEVY IMPORT AUDIT')
    expect(text).toContain('Players imported (matched): 12')
    expect(text).toContain('- Nobody Known (m9)')
    click.mockRestore()
  })

  it("asks Chimmy for the import summary through the existing route", async () => {
    route()
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    fireEvent.click(await screen.findByTestId('import-chimmy-summary'))
    expect(await screen.findByTestId('import-chimmy-summary-text')).toHaveTextContent('Twelve players came across.')
    expect(calls.find(c => c.path === '/api/devy/ai')?.body).toEqual({ action: 'import_summary', sessionId: 'S1' })
  })
})

describe('loading and error states', () => {
  it('shows loading, then a localized not-found error with retry', async () => {
    h.language = 'es'
    handler = () => ({ status: 404, json: { error: 'Not found' } })
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    expect(screen.getByTestId('import-loading')).toHaveTextContent('Cargando…')
    expect(await screen.findByTestId('import-error')).toHaveTextContent('No se encontró esa sesión de importación.')
    expect(screen.getByText('Intentar de nuevo')).toBeInTheDocument()
  })

  it('without a session, later steps send the commissioner back to step 1', async () => {
    handler = () => undefined
    render(<ImportWizard leagueId="L1" />)
    fireEvent.click(screen.getByTestId('import-step-3'))
    expect(screen.getByTestId('import-no-session')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
})

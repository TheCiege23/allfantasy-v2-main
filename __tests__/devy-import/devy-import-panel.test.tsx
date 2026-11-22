import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[h.language]?.[k] ?? dict.en[k] ?? k
  return { useOptionalLanguage: () => ({ language: h.language, t }) }
})

import { DevyImportPanel } from '@/app/devy/components/settings/DevyImportPanel'

function respond(status: number, json: unknown) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
}

beforeEach(() => {
  h.language = 'en'
})
afterEach(() => cleanup())

describe('DevyImportPanel', () => {
  it('for a commissioner: a real link into the wizard and the past sessions from the route', async () => {
    respond(200, {
      sessions: [
        { id: 'S2', status: 'merged', createdAt: '2026-10-02T12:00:00Z', mergedAt: '2026-10-02T13:00:00Z', sources: [{ id: 'a', sourceType: 'league_id_entry', sourcePlatform: 'sleeper', classification: 'nfl_roster', connectionStatus: 'connected' }] },
        { id: 'S1', status: 'matching', createdAt: '2026-10-01T12:00:00Z', mergedAt: null, sources: [] },
      ],
    })
    render(<DevyImportPanel leagueId="L 1" />)
    const sessions = await screen.findByTestId('devy-import-sessions')
    const open = screen.getByTestId('devy-open-import-wizard')
    expect(open.tagName).toBe('A')
    expect(open).toHaveAttribute('href', '/devy/L%201/import')
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/devy/import?leagueId=L%201', { credentials: 'include' })
    expect(sessions).toHaveTextContent('Merged')
    expect(sessions).toHaveTextContent('Sleeper league')
    expect(sessions).toHaveTextContent('No sources added')
    expect(screen.getByTestId('devy-import-session-S2')).toHaveAttribute('href', '/devy/L%201/import?sessionId=S2')
    expect(screen.getByTestId('devy-import-session-S2')).toHaveTextContent('See the audit')
    expect(screen.getByTestId('devy-import-session-S1')).toHaveTextContent('Continue this import')
    expect(document.body.textContent).not.toMatch(/not yet enabled|will list here after merge sessions/)
  })

  it('for anyone else: no link, and it says why (Spanish)', async () => {
    h.language = 'es'
    respond(403, { error: 'Forbidden' })
    render(<DevyImportPanel leagueId="L1" />)
    expect(await screen.findByTestId('devy-import-forbidden')).toHaveTextContent('Solo el comisionado de la liga puede importar.')
    const open = screen.getByTestId('devy-open-import-wizard')
    expect(open.tagName).toBe('BUTTON')
    expect(open).toBeDisabled()
    expect(open).toHaveTextContent('Abrir el asistente de importación')
  })

  it('empty and error states', async () => {
    respond(200, { sessions: [] })
    render(<DevyImportPanel leagueId="L1" />)
    expect(await screen.findByTestId('devy-import-panel-empty')).toHaveTextContent('No imports yet for this league.')
    cleanup()
    respond(500, {})
    render(<DevyImportPanel leagueId="L1" />)
    expect(await screen.findByTestId('devy-import-panel-error')).toHaveTextContent('Something went wrong.')
    expect(screen.getByTestId('devy-open-import-wizard')).toBeDisabled()
  })

  it('the settings modal hands the panel its league', () => {
    const src = readFileSync(resolve(process.cwd(), 'app/league/[leagueId]/components/CommissionerSettingsModal.tsx'), 'utf8')
    expect(src).toMatch(/^\s*<DevyImportPanel leagueId=\{leagueId\} \/>$/m)
  })
})

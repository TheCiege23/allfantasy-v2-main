import { vi } from 'vitest'
vi.mock('next/navigation', () => ({ usePathname: () => '/core/live', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }) }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es', t: (k: string) => k }),
}))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: () => <span data-testid="mini-player-img" />,
}))
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { LiveScores, LockWarning } from '@/components/core-app/screens/LiveScores'
import {
  finalCount,
  liveScoresCopy,
  lockExposure,
  runnersOn,
  slateCountAria,
  startersPlayingNow,
  top25HiddenNote,
  yourStartersHead,
} from '@/lib/core-app/liveScoresCopy'
import type { LivePageData, LiveImpact } from '@/lib/live/liveScoresPage'
import type { LiveLockAlert } from '@/lib/live/lockAlerts'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))

describe('liveScoresCopy', () => {
  it('translates exact-match strings to Spanish', () => {
    expect(liveScoresCopy('Live Scores', 'es')).toBe('Marcadores en vivo')
    expect(liveScoresCopy('My games', 'es')).toBe('Mis partidos')
    expect(liveScoresCopy('All games', 'es')).toBe('Todos los partidos')
    expect(liveScoresCopy('Reconnecting', 'es')).toBe('Reconectando')
    expect(liveScoresCopy('Last play', 'es')).toBe('Última jugada')
  })

  it('passes English through unchanged, and unknown strings through in Spanish', () => {
    expect(liveScoresCopy('Live Scores', 'en')).toBe('Live Scores')
    expect(liveScoresCopy('Live Scores', undefined)).toBe('Live Scores')
    expect(liveScoresCopy('Not a known string', 'es')).toBe('Not a known string')
  })

  it('builds sentences with numbers in both languages', () => {
    expect(slateCountAria(1, 'en')).toBe('1 game in slate')
    expect(slateCountAria(3, 'es')).toBe('3 partidos en la jornada')
    expect(top25HiddenNote(2, 'en')).toBe('Top 25 and teams you follow · 2 other games hidden.')
    expect(finalCount(1, 'es')).toBe('Final · 1 partido')
    expect(yourStartersHead(2, 1, 'en')).toBe('Your starters · 2 players · 1 league')
    expect(yourStartersHead(2, 1, 'es')).toBe('Tus titulares · 2 jugadores · 1 liga')
    expect(startersPlayingNow(1, true, 'en')).toBe('starter playing now in this league')
    expect(runnersOn(['first', 'third'], 'es')).toBe('Corredores en primera y tercera')
    expect(runnersOn(['first', 'third'], 'en')).toBe('Runners on first and third')
  })

  it('never says «waiver» in Spanish', () => {
    const all = [
      'Claim your team in one of your leagues and this fills in automatically.',
      'Contributions by league',
      'No roster contributions available for this view.',
    ].map((s) => liveScoresCopy(s, 'es'))
    for (const s of all) expect(s.toLowerCase()).not.toContain('waiver')
  })
})

const EMPTY_IMPACT: LiveImpact = {
  totalPoints: 0,
  livePlayers: 0,
  liveGames: 0,
  biggestMover: null,
  plays: [],
  upNext: [],
}

function pageData(over: Partial<LivePageData> = {}): LivePageData {
  return {
    sport: 'NFL',
    scope: 'my',
    counts: [{ sport: 'NFL', label: 'NFL', slateCount: 0 }],
    games: [],
    impact: EMPTY_IMPACT,
    lockAlerts: [],
    fetchedAt: new Date().toISOString(),
    hasRosterData: false,
    loadFailed: false,
    rosterFailed: false,
    ...over,
  } as LivePageData
}

describe('LiveScores rendered in Spanish', () => {
  it('shows the Spanish title, controls and empty slate', () => {
    render(<LiveScores data={pageData()} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Marcadores en vivo')
    expect(screen.getByRole('button', { name: 'Mis partidos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todos los partidos' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Busca equipo, partido o tu jugador')).toBeInTheDocument()
    expect(screen.getByText('Ninguno de tus jugadores está jugando ahora mismo.')).toBeInTheDocument()
    expect(screen.queryByText('None of your players are playing right now.')).toBeNull()
  })

  it('says the rosters failed in Spanish', () => {
    render(<LiveScores data={pageData({ rosterFailed: true })} />)
    expect(screen.getByText('No pudimos leer tus plantillas.')).toBeInTheDocument()
  })

  it('renders the lock warning in Spanish', () => {
    const NOW = new Date('2026-09-18T17:00:00Z').getTime()
    const alert: LiveLockAlert = {
      gameId: 'g1',
      matchup: 'KC @ BUF',
      kickoffAt: new Date(NOW + 20 * 60_000).toISOString(),
      leagues: [{ leagueId: 'L1', leagueName: 'Dynasty', starters: 0, bench: 2 }],
      starters: 0,
      bench: 2,
    }
    const { container } = render(<LockWarning alerts={[alert]} now={NOW} />)
    expect(container.textContent).toContain('Se cierra una decisión de alineación')
    expect(container.textContent).toContain('empieza en 20m')
    expect(container.textContent).toContain('2 en la banca · Dynasty')
    expect(lockExposure(alert, 'en')).toBe('2 benched · Dynasty')
  })
})

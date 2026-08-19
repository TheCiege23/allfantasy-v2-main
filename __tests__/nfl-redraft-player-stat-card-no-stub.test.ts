import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

/**
 * Beta Polish Phase 1 — P0 stub removal.
 *
 * The NFL Redraft player-detail card (opened on player click in LeagueShell) must not leak
 * developer placeholder copy, raw ids, or fabricated projection numbers to beta users. This is a
 * source-level contract test (the component renders behind two fetch hooks, so a source scan is the
 * lightest reliable guard — matching the repo's existing production-smoke-blocker pattern).
 */
describe('NFL Redraft PlayerStatCard — no dev-stub leakage', () => {
  const card = read('app/league/[leagueId]/components/PlayerStatCard.tsx')

  it('exposes no developer placeholder / provider-wiring copy', () => {
    expect(card).not.toMatch(/placeholder/i)
    expect(card).not.toMatch(/wire your provider/i)
    expect(card).not.toMatch(/\bTODO\b/)
    expect(card).not.toMatch(/\bmock\b/i)
    // the synthetic per-player baseline stub must be gone at the root (fed both the visible line
    // and the weather block's fabricated point totals)
    expect(card).not.toContain('placeholderBaselineProjection')
    expect(card).not.toContain('components/weather/placeholderBaseline')
  })

  it('exposes no raw ids in the user-facing card', () => {
    // the old visible "... Player id {playerId}" line
    expect(card).not.toMatch(/player id/i)
    // partial-id-as-name fallback ("Player <last4>")
    expect(card).not.toContain('playerId.slice')
    expect(card).not.toContain('resolvePlayerName')
    // the raw league id that was printed in the subtitle
    expect(card).not.toContain('League {leagueId}')
  })

  it('shows an honest user-safe fallback when projection data is unavailable', () => {
    expect(card).toContain('Detailed projections will appear here when provider data is available.')
    expect(card).toContain('data-testid="player-projection-fallback"')
    // unknown players get a neutral label, never an id-derived name
    expect(card).toContain('Unknown player')
    expect(card).toContain('players[playerId]')
  })

  it('does not fabricate projection numbers — weather block is gated on a real projection', () => {
    expect(card).toContain('const realBaselineProjection: number | null = null')
    expect(card).toContain('const hasProjection = realBaselineProjection !== null')
    expect(card).toContain('const showWeather = outdoor && hasProjection')
    // the AF weather block (which renders point totals) must render only when a real projection exists
    expect(card).toMatch(/showWeather \? \(/)
    expect(card).toMatch(/if \(!showWeather\) return/)
  })
})

// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { legacyBackdropScene, legacyIslandScene } from '@/lib/survivor/survivorLegacyIsland'
import { SurvivorHubBanner } from '@/app/survivor/components/SurvivorHubBanner'
import { SurvivorStatusBadge } from '@/app/survivor/components/SurvivorStatusBadge'

afterEach(cleanup)

/**
 * The standalone Survivor pages (app/survivor/[leagueId]/*) wear the same island look as the /core
 * Survivor screens: one stylesheet scoped to the shell, the core scene art, no sky/cyan accents.
 */
describe('legacy Survivor island look', () => {
  it('picks the hub scene from league state with the core banner precedence', () => {
    expect(legacyIslandScene({ phase: 'finale', councilStatus: 'voting_open' })).toBe('finale')
    expect(legacyIslandScene({ phase: 'pre_merge', councilStatus: 'voting_open', challengeStatus: 'open' })).toBe('tribal')
    expect(legacyIslandScene({ phase: 'pre_merge', playerState: 'exile' })).toBe('exile')
    expect(legacyIslandScene({ phase: 'pre_merge', challengeStatus: 'open' })).toBe('jungle')
    expect(legacyIslandScene({ phase: 'merge', challengeStatus: 'open' })).toBe('merge')
    expect(legacyIslandScene({ phase: 'jury' })).toBe('merge')
    expect(legacyIslandScene({ phase: 'pre_draft' })).toBe('beach')
    expect(legacyIslandScene({})).toBe('beach')
  })

  it('paints a route scene behind every page that exists in public/survivor/scenes', () => {
    const routes = ['', '/tribal', '/exile/tokens', '/jury', '/finale', '/merge', '/swap', '/challenges', '/chat', '/rules']
    for (const r of routes) {
      const scene = legacyBackdropScene(`/survivor/lg1${r}`)
      expect(() => readFileSync(resolve(process.cwd(), `public/survivor/scenes/${scene}.svg`))).not.toThrow()
    }
    expect(legacyBackdropScene('/survivor/lg1/tribal')).toBe('tribal')
    expect(legacyBackdropScene('/survivor/lg1/exile')).toBe('exile')
  })

  it('renders the hub banner on the scene art with the crest and both actions', () => {
    render(
      <SurvivorHubBanner
        scene="tribal"
        leagueName="Reef League"
        sport="NFL"
        week={4}
        phase="pre_merge"
        headline="The elimination vote is open"
        description="Seal your vote."
        primaryAction={{ href: '/survivor/lg1/tribal', label: 'Cast your vote' }}
        secondaryAction={{ href: '/league/lg1', label: 'League dashboard' }}
      />,
    )
    const banner = screen.getByTestId('survivor-hub-banner')
    expect(banner.getAttribute('data-scene')).toBe('tribal')
    expect(banner.getAttribute('style')).toContain('/survivor/scenes/tribal.svg')
    expect(screen.getByRole('heading', { level: 1, name: 'Reef League' })).toBeTruthy()
    expect(screen.getByText('pre merge')).toBeTruthy()
    expect(screen.getByText('Week 4')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Cast your vote/ }).getAttribute('href')).toBe('/survivor/lg1/tribal')
    expect(screen.getByRole('link', { name: 'League dashboard' }).className).toContain('sv-btn')
    expect(banner.querySelector('svg.sv-emblem')).toBeTruthy()
  })

  it('shows immunity in island gold, not cyan', () => {
    render(<SurvivorStatusBadge variant="immune" />)
    const badge = screen.getByRole('status')
    expect(badge.className).toContain('text-[#f2c46b]')
    expect(badge.className).not.toMatch(/cyan|sky/)
  })

  it('imports one scoped stylesheet from the shell and keeps every page free of sky/cyan accents', () => {
    const shell = readFileSync(resolve(process.cwd(), 'app/survivor/[leagueId]/SurvivorAppShell.tsx'), 'utf8')
    expect(shell).toContain("import '@/app/survivor/survivor-island.css'")
    expect(shell).toContain('sv-island')
    const css = readFileSync(resolve(process.cwd(), 'app/survivor/survivor-island.css'), 'utf8')
    expect(css).toMatch(/prefers-reduced-motion: reduce/)
    expect(css).toContain('Cinzel')
    // Every rule is scoped under the shell root, so nothing leaks into the rest of the app.
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/^\s*[^@{}\s][^{}]*\{/gm) ?? []
    for (const sel of selectors) {
      if (/^\s*(\d+%|from\b|to\b)/.test(sel)) continue
      for (const part of sel.replace(/\{$/, '').split(',')) expect(part.trim()).toMatch(/^\.sv-island/)
    }
    const pages = ['page.tsx', 'tribal/page.tsx', 'exile/page.tsx', 'jury/page.tsx', 'challenges/page.tsx', 'tribe/page.tsx', 'episodes/page.tsx', 'rules/page.tsx', 'chat/page.tsx', 'chimmy/page.tsx', 'SurvivorAppShell.tsx']
    for (const p of pages) {
      const src = readFileSync(resolve(process.cwd(), `app/survivor/[leagueId]/${p}`), 'utf8')
      expect(src, p).not.toMatch(/\b(?:text|bg|border|from|to|ring)-(?:sky|cyan)-\d/)
    }
  })
})

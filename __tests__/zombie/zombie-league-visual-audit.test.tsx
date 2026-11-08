/**
 * Zombie league screens, 2026-11-07 visual audit (phone + desktop, dark + light, DB-free harness at
 * /e2e/zombie/[leagueId]/[screen]).
 *
 * 1. Always dark. The app is dark-only, but the site-wide light-mode clamp in app/globals.css recoloured
 *    its text near-black on its own dark grounds: Standings names, matchup scores and the Armory copy
 *    vanished in light mode. The shell and layout roots now carry `af-draft-dark`, the app's opt-out.
 * 2. Home on a phone was 550px wide inside 390. Its grids set columns only from `lg`/`xl`, so below that the
 *    implicit `auto` track grew to the widest unbreakable content and every card's right edge was clipped.
 * 3. A Hot-seat row with two status badges squeezed the team name to "The Bar…"; the badges now wrap.
 * 4. The hero's scene art showed through: on desktop through the bare stat-tile tint ("4OSPITAL" beside the
 *    Survivors count), on a phone straight onto the outbreak meter's labels (the fade leaves the art's right
 *    side bare for a left-aligned title, but below lg the content spans the full width).
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ZombieCommandHero } from '@/components/zombie/ZombieCommandHero'
import { ZombieSceneBackground } from '@/components/zombie/ZombieSceneBackground'

afterEach(cleanup)

const src = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('Zombie league is dark in every mode', () => {
  it('opts the shell root and the layout wrapper out of the light-mode clamp', () => {
    const shell = src('app/zombie/[leagueId]/ZombieLeagueShell.tsx')
    // The shell's outermost element: the first JSX after its `return (`.
    const root = /export default function ZombieLeagueShell[\s\S]*?\n  return \(\s*<div className="([^"]+)"/.exec(shell)
    expect(root?.[1].split(/\s+/)).toContain('af-draft-dark')
    // The layout wraps the toast host too, which sits outside the shell.
    const layout = /return \(\s*<div className="([^"]+)"/.exec(src('app/zombie/[leagueId]/layout.tsx'))
    expect(layout?.[1].split(/\s+/)).toContain('af-draft-dark')
  })
})

describe('Zombie home on a phone', () => {
  const home = src('app/zombie/[leagueId]/ZombieLeagueHomeClient.tsx')

  it('gives every responsive grid an explicit single column below its breakpoint', () => {
    const grids = [...home.matchAll(/className="(grid [^"]*)"/g)].map((m) => m[1].split(/\s+/))
    const responsive = grids.filter((c) => c.some((k) => /^(sm|md|lg|xl|2xl):grid-cols-/.test(k)))
    expect(responsive.length).toBeGreaterThanOrEqual(3)
    for (const classes of responsive) expect(classes.some((k) => /^grid-cols-/.test(k)), classes.join(' ')).toBe(true)
  })

  it('lets a Hot-seat row wrap its badges under the name', () => {
    const row = /'(flex[^']*rounded-2xl border bg-white\/\[0\.03\] px-4 py-3)'/.exec(home)
    expect(row?.[1].split(/\s+/)).toContain('flex-wrap')
    expect(home).toMatch(/<div className="min-w-0 flex-1 basis-\d+">\s*<p[^>]*>Hot seat/)
  })
})

describe('Zombie command hero over its scene art', () => {
  const hero = (
    <ZombieCommandHero
      leagueName="Outbreak League"
      sport="NFL"
      week={10}
      level={null}
      survivorCount={4}
      hordeCount={3}
      whispererCount={1}
      potTotal={400}
      isPaid
      chompinNames={[]}
      whispererPanel={null}
      quickActions={null}
      sceneThemeId="abandoned-hospital"
    />
  )

  it('puts a near-opaque base under each stat tile, keeping the tone tint on top', () => {
    const { container } = render(hero)
    const tiles = [...container.querySelectorAll('.zombie-hero-stat')]
    expect(tiles).toHaveLength(4)
    for (const tile of tiles) {
      const base = /bg-\[rgba\(\d+,\d+,\d+,(0?\.\d+)\)\]/.exec(tile.className)
      expect(Number(base?.[1])).toBeGreaterThanOrEqual(0.75)
      expect((tile.firstElementChild as HTMLElement).className).toMatch(/\bborder\b/)
    }
    expect(container.textContent).toContain('Still in the fight')
  })

  it('evens out the scene below lg, where the hero stacks', () => {
    const { container } = render(hero)
    const scrim = container.querySelector('[data-testid="zombie-scene-stacked-scrim"]')
    expect(scrim?.className.split(/\s+/)).toContain('lg:hidden')
  })

  // Control: other headers (intro modal, join page) keep the plain fade.
  it('adds no scrim when the header does not ask for it', () => {
    const { container } = render(<ZombieSceneBackground themeId="abandoned-hospital" />)
    expect(container.querySelector('[data-testid="zombie-scene-stacked-scrim"]')).toBeNull()
  })
})

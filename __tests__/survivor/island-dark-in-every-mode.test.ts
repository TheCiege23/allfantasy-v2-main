import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 🛑 THE SURVIVOR ISLAND IS DARK IN EVERY MODE, SO IT MUST OPT OUT OF THE LIGHT-MODE CLAMP.
 *
 * app/globals.css recolours `text-white*`, `bg-black`, `bg-slate-*`… to light-mode ink inside
 * `.mode-readable`, except under `.af-draft-dark` — the app's "always dark" opt-out, first used by the
 * draft room (__tests__/draft-room/draft-room-dark-in-every-mode.test.tsx). The island root did not carry
 * it, so in light mode its text went dark on the dark island: player names, tribe scores, the bottom nav
 * labels, nearly all of Intel — and its tiles turned white (2026-11-07 Survivor audit).
 */
const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

describe('Survivor island and the light-mode clamp', () => {
  it('the island root carries the always-dark opt-out', () => {
    const shell = read('app/survivor/[leagueId]/SurvivorAppShell.tsx')
    const root = /className="([^"]*\bsv-island\b[^"]*)"/.exec(shell)
    expect(root).not.toBeNull()
    expect(root![1].split(/\s+/)).toContain('af-draft-dark')
  })

  it('the opt-out is still what the clamp excludes', () => {
    const globals = read('app/globals.css')
    expect(globals).toContain(
      'html[data-mode="light"] .mode-readable [class*="text-white"]:where(:not(.af-draft-dark, .af-draft-dark *))',
    )
  })
})

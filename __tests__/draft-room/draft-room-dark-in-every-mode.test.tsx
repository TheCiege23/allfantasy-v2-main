/**
 * The draft room (live and mock) keeps its dark Sleeper-style palette in every mode (2026-11-02).
 *
 * The site-wide light-mode clamp in app/globals.css rewrites `text-white*` and a list of dark
 * backgrounds under `data-mode="light"`. Inside the room it only rewrote the TEXT: the room's
 * gradients and arbitrary navy hexes are not on the list, so the header, the board's column names
 * and the player list rendered near-black on navy. Every non-dark mode rule now ends in
 * `:where(:not(.af-draft-dark, .af-draft-dark *))`, and the room roots carry `af-draft-dark`.
 *
 * Measured in a compiled preview (1440, light): header title / board column / player name went from
 * rgba(2, 6, 23, 0.92) to white on the same navy grounds; dark mode values are byte-identical.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => {
  const t = (k: string) => k
  const value = () => ({ language: 'en', setLanguage: () => {}, t, tInterpolate: t })
  return { useLanguage: value, useOptionalLanguage: value }
})

import { DraftRoomShell } from '@/components/app/draft-room/DraftRoomShell'

afterEach(cleanup)
beforeEach(() => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))))

const EXCLUSION = ':where(:not(.af-draft-dark, .af-draft-dark *))'
const NON_DARK_MODE = /^html(\[data-mode=["'](light|legacy)["']\]|:not\(\[data-mode="dark"\]\))/

function splitTopLevel(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let buf = ''
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth += 1
    if (ch === ')' || ch === ']') depth -= 1
    if (ch === ',' && depth === 0) {
      out.push(buf)
      buf = ''
    } else buf += ch
  }
  out.push(buf)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Every selector in a stylesheet (comments stripped; at-rule preludes and keyframe steps skipped). */
function selectorsOf(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const m of clean.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1]!.split(';').pop()!.trim()
    if (!prelude || prelude.startsWith('@') || /^(from|to|\d+%)/.test(prelude)) continue
    out.push(...splitTopLevel(prelude))
  }
  return out
}

/** A selector that reaches below <html> (not a token block on <html> itself). */
function targetsDescendant(selector: string): boolean {
  const rest = selector.replace(NON_DARK_MODE, '').replace(/^(:not\([^)]*\))+/, '')
  return rest.trim().length > 0
}

describe('the light-mode clamp stops at the draft room', () => {
  const selectors = selectorsOf(readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8'))
  const nonDark = selectors.filter((s) => NON_DARK_MODE.test(s) && targetsDescendant(s))

  it('finds the clamp rules (a parser that matched nothing would pass vacuously)', () => {
    expect(nonDark.length).toBeGreaterThan(150)
    expect(nonDark.some((s) => s.includes('.mode-readable [class*="text-white"]'))).toBe(true)
  })

  it('every light / legacy / not-dark rule excludes .af-draft-dark', () => {
    const missing = nonDark.filter((s) => !s.includes(EXCLUSION))
    expect(missing).toEqual([])
  })
})

describe('the room roots opt out', () => {
  it('the live room shell carries af-draft-dark', () => {
    render(
      <DraftRoomShell
        topBar={<div />}
        managerStrip={null}
        draftBoard={<div />}
        playerPanel={<div />}
        queuePanel={<div />}
        chatPanel={<div />}
        mobileTab="board"
        onMobileTabChange={() => {}}
      />,
    )
    expect(screen.getByTestId('draft-room-shell').className.split(/\s+/)).toContain('af-draft-dark')
  })

  it('the Sleeper-style mock room and the top-bar menu portal carry it too', () => {
    const mock = readFileSync(resolve(process.cwd(), 'components/mock-draft/MockDraftSleeperRoomClient.tsx'), 'utf8')
    expect(mock.match(/className="af-draft-dark min-h-screen/g)?.length).toBe(5)
    const topBar = readFileSync(resolve(process.cwd(), 'components/app/draft-room/DraftTopBar.tsx'), 'utf8')
    expect(topBar).toMatch(/className="fixed z-\[9999\][^"]* af-draft-dark"/)
  })
})

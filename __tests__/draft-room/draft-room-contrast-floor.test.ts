import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { positionTintHex } from '@/lib/draft-room/positionTint'
import { SKIN_ON_FILL } from '@/lib/draft-room/sleeperSkin'

/*
 * Every small (11–14px) label in the live draft room must hold WCAG AA 4.5:1 against the surface it
 * actually sits on. Several sat just under it — 4.18 to 4.49 — and a few well under (2.68 to 3.81),
 * measured on /e2e/draft-room-fixture at 390x844 and 1280x800 (2026-11-25). Each was raised by the
 * smallest alpha/opacity step that clears 4.5 in every row state it can be in.
 *
 * The alphas are READ FROM THE SOURCE, so reverting a class reddens this test. The surfaces are the
 * computed backgrounds measured in the browser (a translucent panel is listed as its composite).
 */

const root = process.cwd()
const src = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

type Rgb = [number, number, number]
const hex = (h: string): Rgb => {
  const v = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb
}
const lum = ([r, g, b]: Rgb) => {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const WHITE: Rgb = [255, 255, 255]
/** `text-white/NN` on `bg`. */
const whiteAt = (pct: number, bg: string) => ratio(over(WHITE, pct / 100, hex(bg)), hex(bg))

function capture(file: string, re: RegExp): number {
  const m = src(file).match(re)
  expect(m, `${file} no longer matches ${re}`).not.toBeNull()
  return Number(m![1])
}

describe('draft board tile: dark text on a position fill', () => {
  const cell = 'components/app/draft-room/DraftBoardCell.tsx'
  const initialOpacity = capture(cell, /font-medium opacity-(\d+)">\{firstName/)
  const infoOpacity = capture(cell, /leading-\[13px\] opacity-(\d+) af-tile-info/)
  const fills = [
    ...new Set(
      ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DL', 'LB', 'DB', 'SG', 'RP', 'OF', 'DH'].map((p) => positionTintHex(p, 'NFL')!),
    ),
  ]

  it.each(fills)('the first initial and the position · team line hold 4.5:1 on %s', (fill) => {
    const bg = hex(fill)
    for (const op of [initialOpacity, infoOpacity]) {
      expect(ratio(over(hex(SKIN_ON_FILL), op / 100, bg), bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('white labels on the room surfaces', () => {
  const cases: Array<{ name: string; file: string; re: RegExp; surfaces: string[] }> = [
    // Pool rows: the panel, then the hover and selected row fills.
    { name: 'pool team', file: 'components/app/draft-room/SleeperPoolTable.tsx', re: /truncate text-\[11px\] text-white\/(\d+)">\{p\.team\}/, surfaces: ['#0d1424', '#1d2236', '#2a2f45'] },
    { name: 'pool empty stat', file: 'components/app/draft-room/SleeperPoolTable.tsx', re: /display === '—' \? 'text-white\/(\d+)'/, surfaces: ['#0d1424', '#1d2236', '#2a2f45'] },
    { name: 'pool rank', file: 'components/app/draft-room/SleeperPoolTable.tsx', re: /text-white\/(\d+) text-\[11px\] font-medium" data-testid=\{`\$\{testIdBase\}-rk`\}/, surfaces: ['#0d1424', '#1d2236', '#2a2f45'] },
    { name: 'position pill count', file: 'components/app/draft-room/PlayerPanel.tsx', re: /isActive \? 'opacity-70' : 'text-white\/(\d+)'/, surfaces: ['#1d2236', '#2a2f45'] },
    { name: 'roster section header', file: 'components/app/draft-room/ResultsRosterPanel.tsx', re: /bg-\[#0a1228\][^"]*text-white\/(\d+)">/, surfaces: ['#0a1228'] },
    { name: 'intel "Needs"', file: 'components/app/draft-room/DraftIntelPanel.tsx', re: /tracking-wide text-white\/(\d+)">Needs/, surfaces: ['#141b2b', '#0f1624'] },
    { name: 'intel ADP', file: 'components/app/draft-room/DraftIntelPanel.tsx', re: /text-\[11px\] text-white\/(\d+)">ADP/, surfaces: ['#141b2b', '#0f1624'] },
    { name: 'board legend', file: 'components/app/draft-room/DraftBoard.tsx', re: /tracking-\[0\.12em\] text-white\/(\d+) max-md:hidden"\s*data-testid="draft-board-legend"/, surfaces: ['#051323'] },
    { name: 'Chimmy voice status', file: 'components/chimmy/ChimmyVoiceBar.tsx', re: /text-white\/(\d+)">Voice \(unavailable\)/, surfaces: ['#0b0f17'] },
    { name: 'Chimmy "Assistant mode"', file: 'components/chimmy/ChimmyAssistantModeSelector.tsx', re: /text-white\/(\d+)">Assistant mode/, surfaces: ['#091126'] },
    { name: 'Chimmy "Sport"', file: 'components/chimmy/ChimmyChatShell.tsx', re: /text-white\/(\d+)">Sport</, surfaces: ['#091126'] },
  ]

  it.each(cases)('$name holds 4.5:1', ({ file, re, surfaces }) => {
    const pct = capture(file, re)
    for (const s of surfaces) expect(whiteAt(pct, s), `${file} on ${s}`).toBeGreaterThanOrEqual(4.5)
  })

  it('Chimmy mode descriptions hold 4.5:1 (white/55 inside an opacity step)', () => {
    const op = capture('components/chimmy/ChimmyAssistantModeSelector.tsx', /leading-tight opacity-(\d+)">\{cfg\.description\}/)
    expect(whiteAt(55 * (op / 100), '#131b2e')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('locked-feature "Sign up free" button', () => {
  const CYAN: Record<string, string> = { '500': '#06b6d4', '600': '#0891b2', '700': '#0e7490', '800': '#155e75' }
  it('white text holds 4.5:1 on its fill and on its hover fill', () => {
    const card = src('components/subscription/LockedFeatureCard.tsx')
    const m = card.match(/bg-cyan-(\d+) [^"]*hover:bg-cyan-(\d+)[^"]*"\s*data-testid="locked-feature-signup-link"/)
    expect(m).not.toBeNull()
    for (const shade of [m![1], m![2]]) expect(ratio(WHITE, hex(CYAN[shade]!))).toBeGreaterThanOrEqual(4.5)
  })
})

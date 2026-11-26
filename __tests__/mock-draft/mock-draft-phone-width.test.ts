import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The mock draft simulator's "Customize Simulation" card on a phone (2026-11-24). Its eight tool buttons sat in a
 * nowrap flex row inside a one-column grid, which set the track's minimum width: a 390px phone got a 1,448px page.
 * The row now spans the card and lays out as a two-column grid on a phone; settings are two across.
 * Read from source with comments stripped, so a check cannot match the comment describing the bug.
 */
const src = readFileSync(join(process.cwd(), 'components/MockDraftSimulatorClient.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('mock draft Customize Simulation on a phone', () => {
  it('the tool buttons wrap in a full-width grid, never one nowrap row', () => {
    expect(src).toMatch(/<div className="col-span-2 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end md:col-span-3" data-testid="mock-draft-actions">/)
    expect(src).not.toMatch(/<div className="flex items-end gap-3">\s*<Button onClick=\{startMockDraft\}/)
    expect(src).toMatch(/data-testid="mock-draft-run-button"[^>]*className="col-span-2 /)
  })

  it('the settings are two across on a phone, three from md', () => {
    expect(src).toMatch(/<div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6" data-testid="mock-draft-customize">/)
  })
})

/**
 * Fantasy OS Suite — Phase V2.0: Executive Visualization Engine.
 *
 * This suite also covered the Commissioner OS League Health Map and its view-model builders on the old
 * /commissioner-hub page. That page, the map and the builders were retired on 2026-09-17 (the
 * five-doors restyle). What stays is what the other executive workspaces still use: the status tokens,
 * and the provider-agnostic boundary of the shared status types.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXECUTIVE_STATUS_SURFACE,
  EXECUTIVE_STATUS_LABEL,
} from '@/components/executive-viz/executiveVizTokens'

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

describe('Executive Viz status semantics reuse Visual OS tokens (Phase V2.0)', () => {
  it('every status surface routes through the semantic status-* tokens, never a raw hue or hex', () => {
    for (const cls of Object.values(EXECUTIVE_STATUS_SURFACE)) {
      // must use status-*/surface-*/subtle semantic tokens, not e.g. bg-emerald-500 or #hex
      expect(cls).not.toMatch(/#[0-9a-fA-F]{3,6}/)
      expect(cls).not.toMatch(/(emerald|amber|rose|orange|cyan|violet|lime|sky)-\d{3}/)
    }
    expect(EXECUTIVE_STATUS_LABEL.at_risk).toBe('Needs attention')
    expect(EXECUTIVE_STATUS_LABEL.unavailable).toBe('Not available')
  })
})

describe('Phase V2.0 data-integrity boundary — source scans', () => {
  it('the shared status types import no provider payload types and reference no provider names', () => {
    const source = readSource('lib', 'executive-viz', 'commissionerLeagueHealthViewModel.ts')
    const codeLines = source
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/*') && !l.trimStart().startsWith('//'))
      .join('\n')
      .toLowerCase()
    for (const banned of ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']) {
      expect(codeLines).not.toContain(banned)
    }
    expect(source.toLowerCase()).not.toContain('sparkline')
  })
})

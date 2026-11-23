import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withListLeagueSettings } from '@/lib/league/clientLeagueSettings'

/*
 * 🛑 The league page handed every league in the viewer's list to the client with its FULL settings,
 * including the importer's `identity_mappings` — 4.4 MB of a 5.6 MB page for an owner with 69
 * imported leagues, and Chrome froze 30+ s parsing it (2026-11-23).
 */
describe('withListLeagueSettings', () => {
  const imported = {
    id: 'L1',
    name: 'Imported',
    settings: {
      scoringSettings: { rec: 1 },
      identity_mappings: Array.from({ length: 500 }, (_, i) => ({ stable_key: `p${i}`, entity_type: 'player' })),
      psychologyCache: { r1: { archetype: 'x' } },
    },
  }

  it('drops identity_mappings and the hidden manager labels, keeps every other key', () => {
    const out = withListLeagueSettings(imported)
    expect(out.settings).toEqual({ scoringSettings: { rec: 1 } })
    expect(out.id).toBe('L1')
    expect(out.name).toBe('Imported')
  })

  it('never changes the row it was given', () => {
    withListLeagueSettings(imported)
    expect(imported.settings.identity_mappings).toHaveLength(500)
  })

  it('returns a league with nothing to drop unchanged (same reference)', () => {
    const native = { id: 'L2', settings: { scoringSettings: { rec: 0.5 } } }
    expect(withListLeagueSettings(native)).toBe(native)
  })

  it('passes non-object settings through', () => {
    const odd = { id: 'L3', settings: null }
    expect(withListLeagueSettings(odd)).toBe(odd)
  })

  it('[control] the slim list is a fraction of the full one once serialized', () => {
    const full = JSON.stringify(imported).length
    const slim = JSON.stringify(withListLeagueSettings(imported)).length
    expect(slim).toBeLessThan(full / 10)
  })

  it('the league page passes the slimmed list, not the raw rows', () => {
    const src = readFileSync(join(process.cwd(), 'app/league/[leagueId]/page.tsx'), 'utf8')
    expect(src).toMatch(/^\s*allLeagues=\{allLeagues\.map\(withListLeagueSettings\)\}/m)
    expect(src).not.toMatch(/^\s*allLeagues=\{allLeagues\}/m)
  })
})

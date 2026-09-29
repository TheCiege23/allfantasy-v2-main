import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import {
  projectPlayerMetadata,
  resolvePlayerMetadata,
  type PlayerMetadataPort,
} from '@/lib/decision-os/world'
import type { RawPlayerMetadataRow } from '@/lib/decision-os/world/facts'

/**
 * Phase D.1 — Canonical World player-metadata enrichment (read-only).
 *
 * Proves the SportsPlayer-backed enrichment seam resolves canonical roster ids (provider ids for imported
 * leagues) into real name/position/team/injury; that bye week + projections stay honestly null; and that
 * the seam performs no writes and no live provider API calls (it reads only the persisted cache).
 * Provider ids stay provenance.
 *
 * The cases that drove this seam THROUGH the lineup canonical bridge (`scanIncomplete` clearing, the
 * enriched lineup input) were removed 2026-09-29 with `lib/decision-os/lineup/canonicalBridge.ts`,
 * deleted alongside the lineup shadow runner that was its only production caller.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

// Real Sleeper-style ids from the imported fixture roster-row-A (after the '0' placeholder is dropped).
const ROSTER_IDS = ['4046', '6794', '4035', '2133']

const row = (id: string, over: Partial<RawPlayerMetadataRow> = {}): RawPlayerMetadataRow => ({
  externalId: id,
  sleeperId: id,
  name: `Player ${id}`,
  position: 'WR',
  team: 'KC',
  status: null,
  source: 'sleeper',
  ...over,
})

const fullRows: RawPlayerMetadataRow[] = [
  row('4046', { name: 'Josh Allen', position: 'QB', team: 'BUF' }),
  row('6794', { name: 'Justin Jefferson', position: 'WR', team: 'MIN', status: 'QUESTIONABLE' }),
  row('4035', { name: 'Alvin Kamara', position: 'RB', team: 'NO' }),
  row('2133', { name: 'Mike Evans', position: 'WR', team: 'TB' }),
]

const fakePort = (rows: RawPlayerMetadataRow[]): PlayerMetadataPort => ({ loadRows: vi.fn(async () => rows) })

describe('Phase D.1 — (1) player ids enrich to names/positions when metadata exists', () => {
  it('resolves provider ids to real name/position/team/injury via the seam', async () => {
    const res = await resolvePlayerMetadata('NFL', ROSTER_IDS, fakePort(fullRows))
    expect(res.complete).toBe(true)
    const allen = res.byId.get('4046')!
    expect(allen.name).toBe('Josh Allen')
    expect(allen.position).toBe('QB')
    expect(allen.team).toBe('BUF')
    expect(res.byId.get('6794')!.injuryStatus).toBe('QUESTIONABLE')
  })

  it('indexes a row by BOTH externalId and sleeperId (provider key)', () => {
    const res = projectPlayerMetadata([row('player-x', { externalId: 'player-x', sleeperId: '4046', name: 'Josh Allen', position: 'QB' })], ['4046'])
    expect(res.byId.get('4046')!.name).toBe('Josh Allen')
  })
})

describe('Phase D.1 — (2) missing metadata keeps structured warnings', () => {
  it('reports unresolved ids + honest warnings when no rows resolve', () => {
    const res = projectPlayerMetadata([], ROSTER_IDS)
    expect(res.complete).toBe(false)
    expect(res.unresolvedIds).toEqual(ROSTER_IDS)
    expect(res.warnings).toContain('player_metadata_missing')
    expect(res.warnings).toContain('bye_week_unavailable')
    expect(res.warnings).toContain('projection_unavailable')
  })

  it('partial rows → still incomplete, resolved flag only for the rows present', () => {
    const res = projectPlayerMetadata([row('4046', { name: 'Josh Allen', position: 'QB' })], ROSTER_IDS)
    expect(res.complete).toBe(false)
    expect(res.byId.get('4046')!.resolved).toBe(true)
    expect(res.byId.get('6794')!.resolved).toBe(false)
    expect(res.unresolvedIds).toEqual(['6794', '4035', '2133'])
  })
})

describe('Phase D.1 — (3) no writes occur', () => {
  it('the seam + port perform ZERO writes', () => {
    for (const rel of ['lib/decision-os/world/playerMetadata.ts', 'lib/decision-os/world/port.ts']) {
      const src = read(rel)
      expect(`${rel}:${/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)}`).toBe(`${rel}:false`)
    }
  })

  it('the metadata read uses a read-only findMany on the SportsPlayer cache', () => {
    const src = read('lib/decision-os/world/port.ts')
    expect(src).toContain('prisma.sportsPlayer.findMany')
  })
})

describe('Phase D.1 — (4) no live provider API calls occur', () => {
  it('the seam never fetches a live API nor imports the live players cache', () => {
    const src = read('lib/decision-os/world/playerMetadata.ts')
    expect(/fetch\(/.test(src)).toBe(false)
    for (const banned of ['sleeper-client', 'players-cache', 'getAllPlayers', 'getSleeperPlayersDict', 'api.sleeper.app']) {
      expect(`${banned}:${src.includes(banned)}`).toBe(`${banned}:false`)
    }
  })

  it('the port reads only the persisted cache (no live fetch)', () => {
    const src = read('lib/decision-os/world/port.ts')
    expect(/fetch\(/.test(src)).toBe(false)
    expect(src.includes('api.sleeper.app')).toBe(false)
  })
})

describe('Phase D.1 — (7) projections remain null when projections are unavailable', () => {
  it('even with full name/position metadata, projection fields stay null (never fabricated)', () => {
    const meta = projectPlayerMetadata(fullRows, ROSTER_IDS)
    expect(meta.complete).toBe(true)
    expect(meta.byId.get('4046')!.projectedPoints).toBeNull()
    expect(meta.byId.get('4046')!.projectionConfidence).toBeNull()
  })
})

describe('Phase D.1 — (8) provider ids stay provenance-only', () => {
  it('provenance lives only on the metadata record', () => {
    const meta = projectPlayerMetadata(fullRows, ROSTER_IDS)
    expect(meta.byId.get('4046')!.source).toBe('sleeper')
  })
})

describe('Phase D.1 — (9) degradation', () => {
  it('the resolver degrades (never throws) when the metadata port read fails', async () => {
    const throwingPort: PlayerMetadataPort = {
      loadRows: async () => {
        throw new Error('db down')
      },
    }
    const res = await resolvePlayerMetadata('NFL', ROSTER_IDS, throwingPort)
    expect(res.complete).toBe(false)
    expect(res.warnings).toContain('player_metadata_source_unavailable')
    expect(res.unresolvedIds).toEqual(ROSTER_IDS)
  })
})

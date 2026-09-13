// @vitest-environment node
/**
 * Fleaflicker's Sportradar ids are WIRED end to end — fetch → adapter → default identity
 * mapper → persistence metadata — and CARRIED, never resolved.
 *
 * 🛑 THE TWO TRAPS THIS FILE PINS ARE BOTH SILENT:
 *
 * 1. THE MISSING `type`. The vendor schema says `{ type, id }`; the wire sends `{ id }`.
 *    A `type === 'SPORTRADAR'` filter matches nothing and reports a clean import with no
 *    ids. The G-11 probe measured exactly that: 0 of 761.
 *
 * 2. THE ALL-OR-NOTHING PIPELINE. `runImportNormalizationPipeline` builds the default
 *    league/team/manager/player mappings only when the adapter emits NONE. An adapter that
 *    helpfully emits player mappings would silently erase every team and manager mapping.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { FleaflickerAdapter } from '@/lib/league-import/adapters/fleaflicker/FleaflickerAdapter'
import { DefaultExternalIdentityMapper } from '@/lib/league-import/mappers/DefaultExternalIdentityMapper'
import { runImportNormalizationPipeline } from '@/lib/league-import/ImportNormalizationPipeline'
import type { FleaflickerImportPayload } from '@/lib/league-import/fleaflicker/types'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const fx = (n: string) => JSON.parse(read(`contracts/fleaflicker/fixtures/${n}`))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const STANDINGS = fx('standings.NFL.json')
const ROSTERS_SR = fx('rosters.NFL.2021.sportradar.json')
const ROSTERS_PLAIN = fx('rosters.NFL.2021.json')

function payload(rosters: unknown): FleaflickerImportPayload {
  return { sport: 'NFL', season: 2021, standings: STANDINGS, rosters, rules: null, draftBoard: null } as FleaflickerImportPayload
}

describe('the adapter carries the Sportradar id into player_map', () => {
  it('every player from a SPORTRADAR roster gets external_ids.sportradar as a UUID', async () => {
    const r = await FleaflickerAdapter.normalize(payload(ROSTERS_SR))
    const entries = Object.values(r.player_map)
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      expect(e.external_ids?.sportradar).toMatch(UUID)
    }
  })

  it('CONTROL: a roster fetched WITHOUT the parameter yields no external_ids at all', async () => {
    /* Without this, a fixture that always carried ids would make the test above pass for free. */
    const r = await FleaflickerAdapter.normalize(payload(ROSTERS_PLAIN))
    const entries = Object.values(r.player_map)
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) expect('external_ids' in e).toBe(false)
  })

  it('the id is the vendor value verbatim — nothing reformatted', async () => {
    const r = await FleaflickerAdapter.normalize(payload(ROSTERS_SR))
    const first = ROSTERS_SR.rosters[0].players[0].proPlayer
    expect(r.player_map[String(first.id)].external_ids?.sportradar).toBe(first.externalIds[0].id)
  })
})

describe('🛑 the `type` rule: absent is accepted, SPORTRADAR is accepted, anything else is refused', () => {
  const rostersWith = (externalIds: unknown[]) => ({
    rosters: [{ team: { id: 1, name: 't' }, players: [{ proPlayer: { id: 42, nameFull: 'P', externalIds } }] }],
  })
  const srOf = async (externalIds: unknown[]) =>
    (await FleaflickerAdapter.normalize(payload(rostersWith(externalIds)))).player_map['42']?.external_ids?.sportradar

  it('an entry with NO type — the shape the wire actually sends — is accepted', async () => {
    expect(await srOf([{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }])).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  })

  it('an entry typed SPORTRADAR — the documented shape — is accepted', async () => {
    expect(await srOf([{ type: 'SPORTRADAR', id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }])).toBe(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    )
  })

  it('an entry typed as some OTHER id space is refused — never mislabelled as Sportradar', async () => {
    expect(await srOf([{ type: 'ROTOWIRE', id: '12345' }])).toBeUndefined()
  })

  it('empty or missing ids produce no external_ids key rather than an empty string', async () => {
    const r = await FleaflickerAdapter.normalize(payload(rostersWith([{ id: '' }, { id: null }])))
    expect('external_ids' in r.player_map['42']).toBe(false)
  })
})

describe('🛑 the adapter emits NO identity_mappings, so the pipeline still builds all of them', () => {
  it('the adapter leaves identity_mappings empty', async () => {
    const r = await FleaflickerAdapter.normalize(payload(ROSTERS_SR))
    expect(r.identity_mappings ?? []).toHaveLength(0)
  })

  it('the default mapper copies external_ids onto PLAYER mappings and still builds the others', async () => {
    const r = await FleaflickerAdapter.normalize(payload(ROSTERS_SR))
    const mappings = DefaultExternalIdentityMapper.buildMappings!('fleaflicker', {
      source: r.source,
      rosters: r.rosters,
      player_map: r.player_map,
    })
    const players = mappings.filter((m) => m.entity_type === 'player')
    expect(players.length).toBeGreaterThan(0)
    for (const m of players) expect(m.external_ids?.sportradar).toMatch(UUID)
    // the all-or-nothing trap: non-player mappings must still exist
    expect(mappings.some((m) => m.entity_type === 'team')).toBe(true)
    expect(mappings.some((m) => m.entity_type === 'league')).toBe(true)
  })

  it('a provider with no external ids gets byte-for-byte the old mapping shape', () => {
    const mappings = DefaultExternalIdentityMapper.buildMappings!('fleaflicker', {
      source: { source_provider: 'fleaflicker', source_league_id: 'L' } as never,
      rosters: [],
      player_map: { '7': { name: 'n', position: 'RB', team: 'X' } },
    })
    const p = mappings.find((m) => m.entity_type === 'player')!
    expect(Object.keys(p).sort()).toEqual(['entity_type', 'source_id', 'source_provider', 'stable_key'])
  })

  it('end to end through runImportNormalizationPipeline: player mappings arrive carrying the id', async () => {
    const r = await runImportNormalizationPipeline({ provider: 'fleaflicker', raw: payload(ROSTERS_SR) })
    const players = (r.identity_mappings ?? []).filter((m) => m.entity_type === 'player')
    expect(players.length).toBeGreaterThan(0)
    expect(players.every((m) => UUID.test(m.external_ids?.sportradar ?? ''))).toBe(true)
    expect((r.identity_mappings ?? []).some((m) => m.entity_type === 'team')).toBe(true)
  })
})

describe('persistence stores the ids in metadata and does not resolve internalId', () => {
  const stripComments = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n')
  const code = stripComments(read('lib/league-import/importPersistenceService.ts'))

  it('self-control: the stripper keeps code and drops prose', () => {
    expect(code).toContain('externalEntityMapping.upsert')
    expect(stripComments('/* external_ids: m.external_ids */\nconst a = 1')).not.toContain('external_ids')
    expect(stripComments("const u = 'https://x.test/a'")).toContain('https://x.test/a')
  })

  it('external_ids is written on create AND update, in BOTH persistence paths (4 sites)', () => {
    const hits = code.match(/metadata: \{ stable_key: m\.stable_key, \.\.\.\(m\.external_ids \? \{ external_ids: m\.external_ids \} : \{\}\) \}/g) ?? []
    expect(hits).toHaveLength(4)
  })

  it('and no metadata write was left on the old shape', () => {
    expect(code).not.toMatch(/metadata: \{ stable_key: m\.stable_key \},/)
  })

  it('internalId is still sourced ONLY from af_id — the id is carried, not resolved', () => {
    const internal = code.match(/internalId: [^,\n]+/g) ?? []
    expect(internal.length).toBeGreaterThan(0)
    for (const line of internal) expect(line).toBe('internalId: m.af_id ?? undefined')
  })
})

describe('the fetch service requests the ids, and cannot lose rosters over them', () => {
  const svc = read('lib/league-import/fleaflicker/FleaflickerLeagueFetchService.ts')

  it('requests external_id_type=SPORTRADAR on the rosters call', () => {
    expect(svc).toMatch(/const rostersWithIdsUrl = `\$\{rostersUrl\}&external_id_type=SPORTRADAR`/)
  })

  it('🛑 falls back to the PLAIN rosters request before falling back to no rosters', () => {
    const compact = svc.replace(/\s+/g, ' ')
    expect(compact).toMatch(
      /fetchJson<FleaflickerRostersResponse>\(rostersWithIdsUrl\) \.catch\(\(\) => fetchJson<FleaflickerRostersResponse>\(rostersUrl\)\) \.catch\(\(\) => \(\{ rosters: \[\] \}\)\)/,
    )
  })
})

// @vitest-environment node
/**
 * Pins what the G-11 probe proved about Fleaflicker's `external_id_type=SPORTRADAR`,
 * before anything is built to read it.
 *
 * 🛑 THE FINDING THIS FILE EXISTS FOR: THE LIVE RESPONSE CONTRADICTS ITS OWN SCHEMA.
 * Fleaflicker's Swagger declares `ExternalIdMapping { type, id }`. Every entry observed
 * — 761 rostered players, 80 draft picks — carries ONLY `id`. A reader that filters on
 * `type === 'SPORTRADAR'`, which is exactly what the schema invites, matches NOTHING.
 * That was measured, not guessed: the first production join did it and reported 0 of
 * 761, until the filter was dropped and the same ids resolved at 91.1%.
 *
 * ⚡ WHY IT MATTERS: those ids join `Player.provider_ids.sportradar` by EXACT id —
 * 693 of 761 in production, name agreement 693/694. That is cross-provider player
 * identity as a query parameter instead of a fuzzy-matching project.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const fx = (n: string) =>
  JSON.parse(readFileSync(`contracts/fleaflicker/fixtures/${n}`, 'utf8').replace(/\r\n/g, '\n'))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Mapping = Record<string, unknown>
type ProPlayer = { id?: number; externalIds?: Mapping[] }

const rostersSr = fx('rosters.NFL.2021.sportradar.json')
const draftSr = fx('draftBoard.NFL.2019.sportradar.json')
const rostersPlain = fx('rosters.NFL.2021.json')
const draftPlain = fx('draftBoard.NFL.2019.json')

const rosterPlayers = (d: { rosters: { players?: { proPlayer: ProPlayer }[] }[] }) =>
  d.rosters.flatMap((r) => r.players ?? []).map((p) => p.proPlayer)
const pickPlayers = (d: { rows: { cells?: { player: { proPlayer: ProPlayer } }[] }[] }) =>
  d.rows.flatMap((r) => r.cells ?? []).map((c) => c.player.proPlayer)

/** What a correct reader does: take `id`, because the request already chose the type. */
const sportradarIdsOf = (pp: ProPlayer) =>
  (pp.externalIds ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string')

describe('externalIds is present when requested, on both endpoints', () => {
  it('every rostered player carries a non-empty externalIds array', () => {
    const ps = rosterPlayers(rostersSr)
    expect(ps.length).toBeGreaterThan(0)
    for (const p of ps) {
      expect(Array.isArray(p.externalIds)).toBe(true)
      expect(p.externalIds!.length).toBeGreaterThan(0)
    }
  })

  it('every draft pick carries it too', () => {
    const ps = pickPlayers(draftSr)
    expect(ps.length).toBeGreaterThan(0)
    for (const p of ps) expect(p.externalIds?.length ?? 0).toBeGreaterThan(0)
  })

  it('CONTROL: it is ABSENT when not requested — the committed plain fixtures have no key', () => {
    /*
     * Without this, a fixture that always carried externalIds would make the tests
     * above pass while saying nothing about the parameter. The field is opt-in.
     */
    for (const p of rosterPlayers(rostersPlain)) expect('externalIds' in p).toBe(false)
    for (const p of pickPlayers(draftPlain)) expect('externalIds' in p).toBe(false)
  })
})

describe('🛑 the entries carry `id` ONLY — the documented `type` field is not sent', () => {
  it('every entry has exactly the key set ["id"]', () => {
    const entries = [...rosterPlayers(rostersSr), ...pickPlayers(draftSr)].flatMap(
      (p) => p.externalIds ?? [],
    )
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) expect(Object.keys(e).sort()).toEqual(['id'])
  })

  it('so a reader that filters on type === "SPORTRADAR" finds NOTHING — the trap, pinned', () => {
    const viaType = rosterPlayers(rostersSr).flatMap((p) =>
      (p.externalIds ?? []).filter((m) => m.type === 'SPORTRADAR'),
    )
    expect(viaType).toHaveLength(0)
  })

  it('while reading `id` directly finds one per player', () => {
    for (const p of rosterPlayers(rostersSr)) expect(sportradarIdsOf(p)).toHaveLength(1)
  })
})

describe('the ids are joinable as-is', () => {
  it('are UUID strings, the same bare format Player.provider_ids.sportradar stores', () => {
    const ids = [...rosterPlayers(rostersSr), ...pickPlayers(draftSr)].flatMap(sportradarIdsOf)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(typeof id).toBe('string')
      expect(id).toMatch(UUID)
      expect(id).not.toContain(':') // bare, not "sportradar:<uuid>"
    }
  })

  it('never reuse one id across two Fleaflicker players within a roster set', () => {
    const ids = rosterPlayers(rostersSr).flatMap(sportradarIdsOf)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('and the Fleaflicker integer id is still there alongside it — this ADDS, never replaces', () => {
    for (const p of rosterPlayers(rostersSr)) expect(typeof p.id).toBe('number')
  })
})

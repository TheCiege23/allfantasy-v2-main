import { describe, expect, it } from 'vitest'
import {
  mergeDbPoolIntoRawList,
  normalizeDraftPoolNameForDedupe,
  type DraftPoolRawRow,
  type SportPoolRow,
} from '@/lib/draft-room/getResolvedDraftPoolForLeague'

/*
 * mergeDbPoolIntoRawList used a findIndex scan per pool row — O(pool × list), ~2,400 × ~2,400 for
 * an NHL pool, with no yield (part of the 30s+ first load reported 2026-10-28). It is now indexed
 * by canonical name. The old scan is kept here verbatim as the reference, and the two must agree
 * on every input, including the cases that make an index easy to get wrong.
 */

const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase()

function referenceMerge(
  rawList: DraftPoolRawRow[],
  poolRows: SportPoolRow[],
  mergeCap: number,
  seenNames: Set<string>,
): void {
  for (const p of poolRows) {
    const n = normalizeDraftPoolNameForDedupe(p.full_name ?? '')
    const poolPos = norm(p.position)
    const poolTeam = norm(p.team_abbreviation)
    if (!n) continue
    const existingIdx = rawList.findIndex((r) => {
      const rowName = r.name ?? r.playerName ?? r.full_name ?? ''
      const rowNorm = normalizeDraftPoolNameForDedupe(rowName)
      const rowPos = norm(r.position ?? r.pos ?? '')
      const rowTeam = norm(r.team ?? r.teamAbbr ?? '')
      const posMatch = !poolPos || !rowPos || poolPos === rowPos
      const teamMatch = !poolTeam || !rowTeam || poolTeam === rowTeam
      if (!posMatch || !teamMatch) return false
      return rowNorm === n
    })
    if (existingIdx >= 0) {
      const existing = rawList[existingIdx]!
      const extId = p.external_source_id ?? null
      existing.playerId ??= extId ?? p.player_id ?? undefined
      existing.sleeperId ??= extId ?? undefined
      existing.id ??= extId ?? p.player_id ?? undefined
      existing.imageUrl ??= p.image_url ?? undefined
      existing.team ??= p.team_abbreviation ?? undefined
      existing.injuryStatus ??= p.injury_status ?? undefined
      existing.status ??= p.status ?? undefined
      existing.age ??= p.age ?? undefined
      if ((!existing.secondaryPositions || existing.secondaryPositions.length === 0) && p.secondary_positions?.length) {
        existing.secondaryPositions = [...p.secondary_positions]
      }
      seenNames.add(n)
      continue
    }
    if (rawList.length >= mergeCap) continue
    if (seenNames.has(n)) continue
    seenNames.add(n)
    rawList.push({
      name: p.full_name,
      // Same bytes as the production fallback (a double-encoded em dash, kept as-is there).
      position: p.position ?? '\u00e2\u0080\u0094',
      team: p.team_abbreviation ?? null,
      playerId: p.external_source_id ?? p.player_id ?? null,
      adp: null,
      bye: null,
      injuryStatus: p.injury_status ?? null,
      status: p.status ?? null,
      secondaryPositions: Array.isArray(p.secondary_positions) ? p.secondary_positions : undefined,
      imageUrl: p.image_url ?? null,
      age: p.age ?? null,
    })
  }
}

function rng(seed: number) {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

// Name variants canonicalName folds together (punctuation, case, accents), plus distinct names.
const NAMES = ["Ja'Marr Chase", 'Jamarr Chase', 'JA’MARR CHASE', 'A.J. Brown', 'AJ Brown', 'Luka Dončić', 'Luka Doncic', 'Josh Allen', 'Josh  Allen', 'Kyle Allen', 'Mike Williams', 'Mike Williams Jr.', '']
const POS = ['WR', 'RB', 'QB', '', null]
const TEAMS = ['CIN', 'PHI', 'DAL', '', null]

function makeCase(seed: number) {
  const r = rng(seed)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!
  const raw: DraftPoolRawRow[] = Array.from({ length: Math.floor(r() * 12) }, () => ({
    name: pick(NAMES),
    position: pick(POS) ?? undefined,
    team: pick(TEAMS) ?? undefined,
  }))
  const pool: SportPoolRow[] = Array.from({ length: Math.floor(r() * 16) }, (_, i) => ({
    full_name: pick(NAMES),
    position: (pick(POS) ?? null) as string,
    team_abbreviation: pick(TEAMS) ?? null,
    external_source_id: r() < 0.5 ? `ext-${i}` : null,
    injury_status: r() < 0.3 ? 'Q' : null,
    image_url: r() < 0.3 ? `https://img/${i}.png` : null,
  }))
  return { raw, pool, cap: 4 + Math.floor(r() * 12) }
}

describe('mergeDbPoolIntoRawList (indexed) matches the original scan', () => {
  it('produces identical lists and seen-name sets on 2,000 random cases', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const c = makeCase(seed)
      const a = structuredClone(c.raw)
      const b = structuredClone(c.raw)
      const seenA = new Set<string>()
      const seenB = new Set<string>()
      referenceMerge(a, c.pool, c.cap, seenA)
      mergeDbPoolIntoRawList(b, c.pool, c.cap, false, seenB)
      expect(b, `seed ${seed}`).toEqual(a)
      expect([...seenB].sort(), `seed ${seed}`).toEqual([...seenA].sort())
    }
  })

  it('a row whose team is filled mid-merge stops matching a different team, as before', () => {
    const raw: DraftPoolRawRow[] = [{ name: 'Josh Allen', position: 'QB' }]
    const pool: SportPoolRow[] = [
      { full_name: 'Josh Allen', position: 'QB', team_abbreviation: 'BUF', external_source_id: '1', injury_status: null },
      { full_name: 'Josh Allen', position: 'QB', team_abbreviation: 'JAX', external_source_id: '2', injury_status: null },
    ]
    const expected = structuredClone(raw)
    referenceMerge(expected, pool, 10, new Set())
    mergeDbPoolIntoRawList(raw, pool, 10, false, new Set())
    expect(raw).toEqual(expected)
    expect(raw[0]!.team).toBe('BUF')
  })

  it('stays fast at NHL scale', () => {
    const n = 2400
    const raw: DraftPoolRawRow[] = Array.from({ length: n }, (_, i) => ({ name: `Player Number ${i}`, position: 'C', team: 'ANA' }))
    const pool: SportPoolRow[] = Array.from({ length: n }, (_, i) => ({
      full_name: `Player Number ${i * 2}`,
      position: 'C',
      team_abbreviation: 'ANA',
      external_source_id: String(i),
      injury_status: null,
    }))
    const t0 = performance.now()
    mergeDbPoolIntoRawList(raw, pool, 4500, false, new Set())
    expect(performance.now() - t0).toBeLessThan(1500)
    expect(raw.length).toBe(n + n / 2)
  })
})

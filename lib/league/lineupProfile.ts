import { lineupEntriesFromSettings } from '@/lib/core-app/valueBook'

/**
 * A league's STARTING lineup, counted by slot type. PURE.
 *
 * A trade is only meaningful against the lineup it was made under: a quarterback in a 4-QB league, a
 * tight end in a 2-TE league and a receiver in a 3-WR + 2-FLEX league are each worth more than the same
 * player in a standard league, because more of them have to start. The trade market
 * (`lib/trade-market/formatMarkets.ts`) and the grade both read this one parser, so a league is
 * classified the same way where its trades are MEASURED and where a trade is GRADED.
 *
 * Reads Sleeper `roster_positions` (one entry per slot) and the `starter_slots` map native leagues store
 * (`QB:1`, `SUPER_FLEX:1`), through `lineupEntriesFromSettings` — the same reader the value book uses to
 * decide the 1QB / superflex chart. Bench, IR and taxi are not starters and are ignored.
 */

export type QbClass = 'ONE_QB' | 'SUPERFLEX' | 'QB_HEAVY'

export type LineupPosition = 'QB' | 'RB' | 'WR' | 'TE'

export type LineupProfile = {
  qb: number
  /** Superflex / OP slots: any of QB/RB/WR/TE, filled by a quarterback almost always. */
  sf: number
  rb: number
  wr: number
  te: number
  /** RB/WR/TE flex. */
  flex: number
  /** RB/WR-only flex. */
  wrrb: number
  /** WR/TE-only ("receiver") flex. */
  rec: number
  k: number
  def: number
  idp: number
  /** Starter slots of a name this parser does not know — reported, never guessed at. */
  unknown: number
  /** QB + superflex slots: how many quarterbacks each team can start. */
  qbDemand: number
  /** Null when the lineup has no quarterback slot at all (or could not be read). */
  qbClass: QbClass | null
  /**
   * Starters per team at each position, counting each flex slot by who usually fills it (`FLEX_SHARES`).
   * ⚠ USED ONLY TO PLACE A LEAGUE IN A "FEWER / USUAL / MORE THAN USUAL" BUCKET. The size of any value
   * adjustment is measured from completed trades, never derived from these shares.
   */
  demand: Record<LineupPosition, number>
  /** "1QB · 1SF · 2RB · 3WR · 1TE · 2FLEX" — for labels and reasons. */
  label: string
}

const QB_SLOTS = new Set(['QB'])
const SF_SLOTS = new Set(['SUPER_FLEX', 'SUPERFLEX', 'SF', 'OP', 'QB/RB/WR/TE', 'QB/WR/RB/TE', 'Q/W/R/T'])
const FLEX_SLOTS = new Set(['FLEX', 'W/R/T', 'RB/WR/TE', 'WR/RB/TE', 'WRT', 'FLX'])
const WRRB_SLOTS = new Set(['WRRB_FLEX', 'W/R', 'RB/WR', 'WR/RB'])
const REC_SLOTS = new Set(['REC_FLEX', 'W/T', 'WR/TE', 'TE/WR'])
const DEF_SLOTS = new Set(['DEF', 'DST', 'D/ST', 'TEAM_DEF'])
const IDP_SLOTS = new Set(['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'IDP_FLEX', 'IDP', 'DL/LB', 'LB/DB', 'DL/LB/DB'])
const NOT_STARTERS = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES', 'NA'])

/** Who usually fills each flex slot — see the `demand` caveat above. */
export const FLEX_SHARES = {
  flex: { RB: 0.45, WR: 0.45, TE: 0.1 },
  wrrb: { RB: 0.5, WR: 0.5 },
  rec: { WR: 0.8, TE: 0.2 },
  sf: { QB: 0.9, RB: 0.04, WR: 0.05, TE: 0.01 },
} as const

export function qbClassOf(qbDemand: number): QbClass | null {
  if (!(qbDemand >= 1)) return null
  if (qbDemand === 1) return 'ONE_QB'
  if (qbDemand === 2) return 'SUPERFLEX'
  return 'QB_HEAVY'
}

/** Count a lineup from its slot entries (`'QB'`, `'SUPER_FLEX'`, or `'NAME:count'`). */
export function lineupProfileFromEntries(entries: readonly unknown[]): LineupProfile | null {
  const p = { qb: 0, sf: 0, rb: 0, wr: 0, te: 0, flex: 0, wrrb: 0, rec: 0, k: 0, def: 0, idp: 0, unknown: 0 }
  let starters = 0
  for (const raw of entries) {
    const entry = String(raw ?? '').trim().toUpperCase()
    if (!entry) continue
    // `NAME:count`, where MFL can write a range (`QB:1-2`: up to two) — the upper bound starts.
    const m = /^(.*?):(\d+)(?:-(\d+))?$/.exec(entry)
    const name = (m ? m[1]! : entry).trim()
    const count = m ? Number(m[3] ?? m[2]) : 1
    if (!(count > 0) || NOT_STARTERS.has(name)) continue
    starters += count
    if (QB_SLOTS.has(name)) p.qb += count
    else if (SF_SLOTS.has(name)) p.sf += count
    else if (name === 'RB') p.rb += count
    else if (name === 'WR') p.wr += count
    else if (name === 'TE') p.te += count
    else if (FLEX_SLOTS.has(name)) p.flex += count
    else if (WRRB_SLOTS.has(name)) p.wrrb += count
    else if (REC_SLOTS.has(name)) p.rec += count
    else if (name === 'K' || name === 'PK') p.k += count
    else if (DEF_SLOTS.has(name)) p.def += count
    else if (IDP_SLOTS.has(name)) p.idp += count
    else p.unknown += count
  }
  if (starters === 0) return null
  const qbDemand = p.qb + p.sf
  const demand: Record<LineupPosition, number> = {
    QB: round2(p.qb + p.sf * FLEX_SHARES.sf.QB),
    RB: round2(p.rb + p.flex * FLEX_SHARES.flex.RB + p.wrrb * FLEX_SHARES.wrrb.RB + p.sf * FLEX_SHARES.sf.RB),
    WR: round2(p.wr + p.flex * FLEX_SHARES.flex.WR + p.wrrb * FLEX_SHARES.wrrb.WR + p.rec * FLEX_SHARES.rec.WR + p.sf * FLEX_SHARES.sf.WR),
    TE: round2(p.te + p.flex * FLEX_SHARES.flex.TE + p.rec * FLEX_SHARES.rec.TE + p.sf * FLEX_SHARES.sf.TE),
  }
  const label = [
    p.qb ? `${p.qb}QB` : null,
    p.sf ? `${p.sf}SF` : null,
    p.rb ? `${p.rb}RB` : null,
    p.wr ? `${p.wr}WR` : null,
    p.te ? `${p.te}TE` : null,
    p.flex ? `${p.flex}FLEX` : null,
    p.wrrb ? `${p.wrrb}RB/WR` : null,
    p.rec ? `${p.rec}WR/TE` : null,
  ].filter(Boolean).join(' · ')
  return { ...p, qbDemand, qbClass: qbClassOf(qbDemand), demand, label }
}

/** A league's lineup from its stored settings, or null when it cannot be read. */
export function lineupProfileFromSettings(settings: unknown): LineupProfile | null {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : null
  if (!s) return null
  return lineupProfileFromEntries(lineupEntriesFromSettings(s))
}

/** A lineup from explicit counts — the open analyzer's format picker. */
export function lineupProfileFromCounts(c: Partial<Record<'qb' | 'sf' | 'rb' | 'wr' | 'te' | 'flex', number>>): LineupProfile | null {
  const entries: string[] = []
  const add = (name: string, n: number | undefined) => {
    if (Number.isInteger(n) && (n as number) > 0) entries.push(`${name}:${n}`)
  }
  add('QB', c.qb)
  add('SUPER_FLEX', c.sf)
  add('RB', c.rb)
  add('WR', c.wr)
  add('TE', c.te)
  add('FLEX', c.flex)
  return lineupProfileFromEntries(entries)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

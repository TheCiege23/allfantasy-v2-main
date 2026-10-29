/**
 * An IMPORTED league's lineup template, read from the provider's own roster positions that the
 * import stored in `League.settings.roster_positions` — never the AllFantasy default (owner,
 * 2026-10-27).
 *
 * 🛑 THE DEFAULT TEMPLATE REFUSED MOST ADDS IN IMPORTED LEAGUES. With no saved layout an import fell
 * through `getRosterTemplate` to the AF default (QB, 2 RB, 2 WR, TE, FLEX, K, DST, 7 BN, 1 IR, no
 * taxi), and the waiver / free-agent gate validated the projected roster against it. Measured
 * read-only on production 2026-10-27: 4,871 of 6,734 Sleeper NFL rosters overflow that template
 * (a superflex lineup holds 10 starters, a Sleeper bench is usually more than 7, and any taxi
 * player overflows a template with no taxi), so the add was refused for a lineup the provider
 * itself set. Against the provider's own positions the same count is 295 — the rosters already
 * holding more active players than their league allows, which the roster limit refuses anyway.
 *
 * Two stored shapes, both under `roster_positions`:
 *   - Sleeper: one entry per slot, in lineup order — `["QB","RB","RB","WR","FLEX","SUPER_FLEX","BN",…]`.
 *     IR and taxi are not in it; they are `settings.reserve_slots` / `settings.taxi_slots`.
 *   - ESPN, Yahoo, MFL, Fantrax: `SLOT:COUNT` pairs — `["QB:1","RB:2","D/ST:1","BE:7","IR:1","FLEX:1"]`.
 *
 * ⚠ A SLOT THIS MODULE DOES NOT RECOGNISE RETURNS NULL FOR THE WHOLE LEAGUE, and the caller keeps its
 * old resolution. A template with one seat dropped is a smaller lineup that looks like a real one; so
 * is one whose bench size is guessed. That is also why a pair-shaped list with no bench entry is null:
 * MFL stores starters and taxi only (lib/league/rosterLimit.ts), so its bench size is unknown.
 * Fleaflicker and Fantrax football store no positions at all (2026-10-27: 1 league each).
 *
 * Pure: the non-football slot catalogs are passed in, so this module imports nothing at runtime.
 */
import type { RosterTemplateSlotDto } from '@/lib/multi-sport/RosterTemplateService'

type SlotKind = 'starter' | 'bench' | 'ir' | 'taxi'
type SlotSpec = { kind: SlotKind; name: string; positions: string[] }

const QB = ['QB']
const SKILL = ['RB', 'FB', 'WR', 'TE']
const DL = ['DL', 'DE', 'DT']
const DB = ['DB', 'CB', 'S']
const IDP = [...DL, 'LB', ...DB]

const starter = (name: string, positions: string[]): SlotSpec => ({ kind: 'starter', name, positions })
const BENCH: SlotSpec = { kind: 'bench', name: 'BENCH', positions: [] }
const IR: SlotSpec = { kind: 'ir', name: 'IR', positions: [] }
const TAXI: SlotSpec = { kind: 'taxi', name: 'TAXI', positions: [] }

/**
 * Football provider slot name → our slot. Names are this template's vocabulary (`defaultNflSlots`:
 * FLEX / SUPERFLEX / DST). Positions are what `collectTemplateSectionIssues` compares a starter's
 * position against after `normalizePositionForStarterEligibility` (NT → DT, SS / FS → S, OLB → LB).
 *
 * Sources: Sleeper — the vocabulary in production (`lib/core-app/slotEligibility.ts`); ESPN —
 * `ESPN_SLOT_LABELS` in lib/league-import/espn/EspnLeagueFetchService.ts (`EDR` is left out: what an
 * ESPN edge slot accepts is not established); Yahoo — its football position codes; Fantrax — `RWT` /
 * `SFX`, the slot codes `importedPlayerMetadata.ts` already treats as slots.
 */
const FOOTBALL_SLOTS: Record<string, SlotSpec> = {
  QB: starter('QB', QB),
  TQB: starter('QB', QB),
  RB: starter('RB', ['RB', 'FB']),
  WR: starter('WR', ['WR']),
  TE: starter('TE', ['TE']),
  K: starter('K', ['K']),
  PK: starter('K', ['K']),
  P: starter('P', ['P']),
  HC: starter('HC', ['HC']),
  DEF: starter('DST', ['DEF', 'DST', 'D/ST']),
  DST: starter('DST', ['DEF', 'DST', 'D/ST']),
  'D/ST': starter('DST', ['DEF', 'DST', 'D/ST']),
  FLEX: starter('FLEX', SKILL),
  'W/R/T': starter('FLEX', SKILL),
  RWT: starter('FLEX', SKILL),
  WRRB_WRT: starter('FLEX', SKILL),
  WRRB_FLEX: starter('WRRB_FLEX', ['RB', 'FB', 'WR']),
  'RB/WR': starter('WRRB_FLEX', ['RB', 'FB', 'WR']),
  'W/R': starter('WRRB_FLEX', ['RB', 'FB', 'WR']),
  REC_FLEX: starter('REC_FLEX', ['WR', 'TE']),
  'WR/TE': starter('REC_FLEX', ['WR', 'TE']),
  'W/T': starter('REC_FLEX', ['WR', 'TE']),
  SUPER_FLEX: starter('SUPERFLEX', [...QB, ...SKILL]),
  SUPERFLEX: starter('SUPERFLEX', [...QB, ...SKILL]),
  'Q/W/R/T': starter('SUPERFLEX', [...QB, ...SKILL]),
  OP: starter('SUPERFLEX', [...QB, ...SKILL]),
  SFX: starter('SUPERFLEX', [...QB, ...SKILL]),
  DL: starter('DL', DL),
  DE: starter('DE', ['DE']),
  DT: starter('DT', ['DT']),
  LB: starter('LB', ['LB']),
  DB: starter('DB', DB),
  CB: starter('CB', ['CB']),
  S: starter('S', ['S']),
  IDP_FLEX: starter('IDP_FLEX', IDP),
  DP: starter('IDP_FLEX', IDP),
  D: starter('IDP_FLEX', IDP),
  BN: BENCH,
  BE: BENCH,
  BENCH: BENCH,
  IR: IR,
  TAXI: TAXI,
}

/** Non-football spellings of the catalog keys (`lib/nba-roster`, `lib/mlb-roster`, `lib/nhl-roster`). */
const CATALOG_ALIASES: Record<string, string> = { BE: 'BN', BENCH: 'BN', UT: 'UTIL', 'IL+': 'IL_PLUS', 'IR+': 'IR_PLUS' }
/** Catalog reserve keys that are a taxi squad rather than an injured list. Yahoo's MLB/NHL `NA` is
 *  the minors — the taxi squad (lib/league-import/adapters/yahoo/YahooAdapter.ts). */
const CATALOG_TAXI_KEYS = new Set(['TAXI', 'NA', 'MINORS', 'PROSPECT', 'RIGHTS'])

export type SlotCatalog = ReadonlyMap<string, { eligiblePositions: string[]; category: string }>

function isFootball(sport: string): boolean {
  return sport === 'NFL' || sport === 'NCAAF'
}

function catalogSlot(token: string, catalog: SlotCatalog | null): SlotSpec | null {
  if (!catalog) return null
  const key = CATALOG_ALIASES[token] ?? token
  const def = catalog.get(key)
  if (!def) return null
  if (def.category === 'bench') return { ...BENCH, name: key }
  if (def.category === 'reserve') return CATALOG_TAXI_KEYS.has(key) ? { ...TAXI, name: key } : { ...IR, name: key }
  if (def.category === 'college') return null
  return def.eligiblePositions.length > 0 ? starter(key, [...def.eligiblePositions]) : null
}

/** `roster_positions` as `{ token, count }` entries in stored order, or null when none / unreadable. */
export function parseProviderRosterPositions(raw: unknown): { entries: Array<{ token: string; count: number }>; pairs: boolean } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const tokens = raw.map((v) => String(v ?? '').trim().toUpperCase()).filter(Boolean)
  if (tokens.length === 0) return null
  const pairs = tokens.some((t) => /^.+:\d+$/.test(t))
  if (!pairs) return { entries: tokens.map((token) => ({ token, count: 1 })), pairs }
  const entries: Array<{ token: string; count: number }> = []
  for (const t of tokens) {
    const m = /^(.+):(\d+)$/.exec(t)
    if (!m) return null
    entries.push({ token: m[1]!, count: Number(m[2]) })
  }
  return { entries, pairs }
}

function count(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

export type ImportedLineupLeague = {
  sport: string | null | undefined
  settings: unknown
  /** `League.taxiSlots` — used when the settings carry no taxi count. */
  taxiSlots?: number | null
  /** `League.irSlots` — 0 by default on every row, so used only when positive. */
  irSlots?: number | null
}

/**
 * The provider's lineup as template slots, or null when the league stores no positions this module
 * can read (the caller then keeps its current resolution).
 */
export function importedLineupTemplateSlots(league: ImportedLineupLeague, catalog: SlotCatalog | null = null): RosterTemplateSlotDto[] | null {
  const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {}
  const parsed = parseProviderRosterPositions(settings.roster_positions)
  if (!parsed) return null
  const sport = String(league.sport ?? 'NFL').toUpperCase()

  const starters = new Map<string, { positions: string[]; count: number }>()
  let bench: number | null = parsed.pairs ? null : 0
  let ir: number | null = null
  let taxi: number | null = null
  for (const { token, count: n } of parsed.entries) {
    const spec = isFootball(sport) ? FOOTBALL_SLOTS[token] ?? null : catalogSlot(token, catalog)
    if (!spec) return null
    if (n <= 0) continue
    if (spec.kind === 'bench') bench = (bench ?? 0) + n
    else if (spec.kind === 'ir') ir = (ir ?? 0) + n
    else if (spec.kind === 'taxi') taxi = (taxi ?? 0) + n
    else {
      const prev = starters.get(spec.name)
      starters.set(spec.name, { positions: spec.positions, count: (prev?.count ?? 0) + n })
    }
  }
  if (starters.size === 0 || bench == null) return null

  // Sleeper keeps IR and taxi out of `roster_positions`; its `reserve_slots` is authoritative even at 0.
  ir ??= count(settings.reserve_slots) ?? (league.irSlots != null && league.irSlots > 0 ? league.irSlots : 0)
  taxi ??= count(settings.taxi_slots) ?? count(league.taxiSlots) ?? 0

  const allPositions = [...new Set([...starters.values()].flatMap((s) => s.positions))]
  const row = (slotName: string, allowed: string[], counts: Partial<Pick<RosterTemplateSlotDto, 'starterCount' | 'benchCount' | 'reserveCount' | 'taxiCount'>>, flexible: boolean, slotOrder: number): RosterTemplateSlotDto => ({
    slotName,
    allowedPositions: allowed,
    starterCount: counts.starterCount ?? 0,
    benchCount: counts.benchCount ?? 0,
    reserveCount: counts.reserveCount ?? 0,
    taxiCount: counts.taxiCount ?? 0,
    devyCount: 0,
    isFlexibleSlot: flexible,
    slotOrder,
  })
  const slots: RosterTemplateSlotDto[] = []
  for (const [name, s] of starters) slots.push(row(name, [...s.positions], { starterCount: s.count }, s.positions.length > 1, slots.length))
  if (bench > 0) slots.push(row('BENCH', allPositions, { benchCount: bench }, false, slots.length))
  if (ir > 0) slots.push(row('IR', allPositions, { reserveCount: ir }, false, slots.length))
  if (taxi > 0) slots.push(row('TAXI', allPositions, { taxiCount: taxi }, false, slots.length))
  return slots
}

const SECTION_KEYS = ['starters', 'bench', 'ir', 'taxi', 'devy'] as const

/**
 * An imported roster's lineup rows with each player's position from `playerData.player_metadata`.
 *
 * ⚠ IMPORTS STORE BARE IDS IN `lineup_sections`, and `getNormalizedLineupSections` gives a row with no
 * position the position `UTIL` — which no football slot accepts, so every imported starter read as
 * ineligible. The provider's position is stored beside the roster (61,775 of 61,863 Sleeper starters
 * on 2026-10-27). A row that already names a position, or a player with none on file, is left as is.
 */
export function withImportedPlayerPositions(playerData: unknown): unknown {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return playerData
  const data = playerData as Record<string, unknown>
  const meta = data.player_metadata && typeof data.player_metadata === 'object' ? (data.player_metadata as Record<string, unknown>) : null
  const sections = data.lineup_sections && typeof data.lineup_sections === 'object' && !Array.isArray(data.lineup_sections) ? (data.lineup_sections as Record<string, unknown>) : null
  if (!meta || !sections) return playerData
  const positionOf = (id: string): string | null => {
    const entry = meta[id]
    const pos = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).position : null
    return typeof pos === 'string' && pos.trim() ? pos.trim().toUpperCase() : null
  }
  const next: Record<string, unknown> = { ...sections }
  for (const key of SECTION_KEYS) {
    const rows = sections[key]
    if (!Array.isArray(rows)) continue
    next[key] = rows.map((row) => {
      const obj = row && typeof row === 'object' ? (row as Record<string, unknown>) : null
      const id = typeof row === 'string' ? row.trim() : String(obj?.id ?? obj?.player_id ?? '').trim()
      if (!id || (obj && obj.position != null && String(obj.position).trim())) return row
      const position = positionOf(id)
      return position ? { ...(obj ?? {}), id, position } : row
    })
  }
  return { ...data, lineup_sections: next }
}

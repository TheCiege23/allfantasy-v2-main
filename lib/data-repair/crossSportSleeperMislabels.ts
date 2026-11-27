/**
 * Finding — and, behind a guard, fixing — rows already WRITTEN by Sleeper-id reads that had no sport.
 *
 * 🛑 SLEEPER NUMBERS EACH SPORT SEPARATELY. NFL 1466 is Travis Kelce and NBA 1466 JaVale McGee; NFL
 * 4866 Saquon Barkley / NBA 4866 AJ Dybantsa; NFL 4984 Josh Allen / NBA 4984 Cameron Corhen. Until
 * the sport-scope fix, several reads asked `SportsPlayer` / `PlayerIdentityMap` by `sleeperId` alone
 * and kept whichever row came back, and three of them STORED what they found:
 *
 *   - `LeagueTrade.contextSnapshot` (`backfill_rebuilt`): each roster player's `position` / `team`,
 *     from `tradeContextBackfill`'s `loadPositions`, which was handed the trade's sport and ignored it.
 *   - `AllFantasyAdpSnapshot` (`draftType = 'imported'`): ADP boards built from imported drafts by
 *     `draftFactSamples`, whose identity read let an NBA draft's `1466` resolve to NFL Kelce.
 *   - `LeagueChatMessage.metadata.tradeCard`: the league-chat trade card's player `name` / `position`.
 *
 * This module is the PURE half: given the stored value and the two candidate readings (the right
 * sport's row and the other sports' rows for the same id), it says whether a stored value is the
 * cross-sport mislabel — not merely stale. A value counts as mislabelled only when it DISAGREES with
 * the row of the right sport AND AGREES with a row of another sport under the same id: a position that
 * merely changed since (a WR now listed TE) is drift, and drift is not this bug.
 *
 * No prisma here; `scripts/measure-cross-sport-sleeper-mislabels.ts` does the reading and writing.
 */

/** One sport's reading of a Sleeper id. */
export type SportReading = { sport: string; name: string | null; position: string | null; team: string | null }

/** Readings of one Sleeper id: the row for the sport that was meant, and every other sport's. */
export type IdReadings = { right: SportReading | null; others: SportReading[] }

const norm = (v: string | null | undefined) => String(v ?? '').trim().toUpperCase()
const normName = (v: string | null | undefined) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')

/** One `SportsPlayer` row's reading of a Sleeper id (any source). */
export type PlayerRow = { sleeperId: string | null; sport: string; source?: string | null; name: string | null; position: string | null; team: string | null }

/**
 * Group rows into per-id readings for `rightSport`, the Sleeper-sourced row first within a sport.
 *
 * ⚠ SPORTS COMPARE CASE-INSENSITIVELY. `LeagueTrade.sport` is stored lowercase (`'nfl'`) while
 * `SportsPlayer.sport` is `'NFL'`; compared as written, every NFL row would read as "another sport"
 * and the right reading would be missing — so nothing would ever be found, or worse, everything.
 */
export function buildReadings(rows: readonly PlayerRow[], rightSport: string): Map<string, IdReadings> {
  const right = String(rightSport ?? '').trim().toUpperCase()
  const bySport = new Map<string, Map<string, PlayerRow>>()
  for (const r of rows) {
    if (!r.sleeperId) continue
    const sport = String(r.sport ?? '').trim().toUpperCase()
    const m = bySport.get(r.sleeperId) ?? new Map<string, PlayerRow>()
    const prev = m.get(sport)
    if (!prev || (prev.source !== 'sleeper' && r.source === 'sleeper')) m.set(sport, r)
    bySport.set(r.sleeperId, m)
  }
  const reading = (sport: string, r: PlayerRow): SportReading => ({ sport, name: r.name, position: r.position, team: r.team })
  const out = new Map<string, IdReadings>()
  for (const [id, m] of bySport) {
    const rightRow = m.get(right)
    out.set(id, {
      right: rightRow ? reading(right, rightRow) : null,
      others: [...m].filter(([s]) => s !== right).map(([s, r]) => reading(s, r)),
    })
  }
  return out
}

/**
 * Is a stored POSITION the other sport's? Disagrees with the right sport's row and equals another
 * sport's. Unknown right reading → not provable → false (reported separately as unverifiable).
 */
export function isCrossSportPosition(stored: string | null | undefined, readings: IdReadings): boolean {
  if (!readings.right || !norm(stored)) return false
  if (norm(stored) === norm(readings.right.position)) return false
  return readings.others.some((o) => norm(o.position) === norm(stored))
}

/** Is a stored NAME the other sport's player? Same rule as positions, compared on letters only. */
export function isCrossSportName(stored: string | null | undefined, readings: IdReadings): boolean {
  if (!readings.right || !normName(stored)) return false
  if (normName(stored) === normName(readings.right.name)) return false
  return readings.others.some((o) => normName(o.name) === normName(stored))
}

// ─── LeagueTrade.contextSnapshot ────────────────────────────────────────────────────────────────

type SnapshotPlayer = { id?: unknown; position?: unknown; team?: unknown; [k: string]: unknown }
type SnapshotSide = { rosterBefore?: unknown; [k: string]: unknown }

export type SnapshotCorrection = {
  side: number
  /** Position of the player in that side's `rosterBefore` (for the review SQL's json path). */
  index: number
  playerId: string
  stored: { position: string | null; team: string | null }
  correct: { position: string | null; team: string | null }
  wrongSport: string
}

function sidesOf(snapshot: unknown): SnapshotSide[] {
  if (!snapshot || typeof snapshot !== 'object') return []
  const sides = (snapshot as { sides?: unknown }).sides
  return Array.isArray(sides) ? (sides as SnapshotSide[]) : []
}

/** Every Sleeper id in a snapshot's rosters (the lookup set for `findSnapshotMislabels`). */
export function snapshotPlayerIds(snapshot: unknown): string[] {
  const ids = new Set<string>()
  for (const side of sidesOf(snapshot)) {
    if (!Array.isArray(side.rosterBefore)) continue
    for (const p of side.rosterBefore as SnapshotPlayer[]) if (p && typeof p.id === 'string' && p.id) ids.add(p.id)
  }
  return [...ids]
}

/** The roster players whose stored position is another sport's player's. */
export function findSnapshotMislabels(snapshot: unknown, readingsById: Map<string, IdReadings>): SnapshotCorrection[] {
  const out: SnapshotCorrection[] = []
  sidesOf(snapshot).forEach((side, i) => {
    if (!Array.isArray(side.rosterBefore)) return
    ;(side.rosterBefore as SnapshotPlayer[]).forEach((p, index) => {
      const id = typeof p?.id === 'string' ? p.id : null
      if (!id) return
      const readings = readingsById.get(id)
      if (!readings || !readings.right) return
      const position = typeof p.position === 'string' ? p.position : null
      if (!isCrossSportPosition(position, readings)) return
      const wrong = readings.others.find((o) => norm(o.position) === norm(position))!
      out.push({
        side: i,
        index,
        playerId: id,
        stored: { position, team: typeof p.team === 'string' ? p.team : null },
        correct: { position: readings.right.position, team: readings.right.team },
        wrongSport: wrong.sport,
      })
    })
  })
  return out
}

/** A copy of the snapshot with ONLY the corrected players' position/team replaced. */
export function applySnapshotCorrections<T>(snapshot: T, corrections: readonly SnapshotCorrection[]): T {
  if (corrections.length === 0) return snapshot
  const copy = JSON.parse(JSON.stringify(snapshot)) as { sides?: SnapshotSide[] }
  for (const c of corrections) {
    const roster = copy.sides?.[c.side]?.rosterBefore
    if (!Array.isArray(roster)) continue
    for (const p of roster as SnapshotPlayer[]) {
      if (p?.id !== c.playerId) continue
      p.position = c.correct.position
      p.team = c.correct.team
    }
  }
  return copy as unknown as T
}

// ─── LeagueChatMessage.metadata.tradeCard ───────────────────────────────────────────────────────

type CardAsset = { kind?: unknown; id?: unknown; sleeperId?: unknown; name?: unknown; position?: unknown; team?: unknown; [k: string]: unknown }

/**
 * A card asset's player id, or null when it is not a player.
 *
 * ⚠ THE STORED SHAPE IS `{ id, name, team, position }` — no `kind`, no `sleeperId` (measured on the
 * production card, 2026-11-27). The writer's current type says `{ kind: 'player', sleeperId }`, so
 * both are accepted: `id` first, `sleeperId` as the fallback, and `kind` honoured only when present.
 */
export function cardAssetPlayerId(a: CardAsset | null | undefined): string | null {
  if (!a || typeof a !== 'object') return null
  if (a.kind !== undefined && a.kind !== 'player') return null
  const id = typeof a.id === 'string' || typeof a.id === 'number' ? String(a.id) : typeof a.sleeperId === 'string' ? a.sleeperId : ''
  return id.trim() ? id.trim() : null
}

export type CardCorrection = {
  list: 'gave' | 'got'
  index: number
  playerId: string
  stored: { name: string | null; position: string | null }
  correct: { name: string | null; position: string | null; team: string | null }
  wrongSport: string
}

function cardOf(metadata: unknown): { gave?: unknown; got?: unknown } | null {
  if (!metadata || typeof metadata !== 'object') return null
  const card = (metadata as { tradeCard?: unknown }).tradeCard
  return card && typeof card === 'object' ? (card as { gave?: unknown; got?: unknown }) : null
}

/** Sleeper ids of a trade card's player assets. */
export function cardPlayerIds(metadata: unknown): string[] {
  const card = cardOf(metadata)
  if (!card) return []
  const ids = new Set<string>()
  for (const list of [card.gave, card.got]) {
    if (!Array.isArray(list)) continue
    for (const a of list as CardAsset[]) {
      const id = cardAssetPlayerId(a)
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

/** Card player assets named as another sport's player under the same id. */
export function findCardMislabels(metadata: unknown, readingsById: Map<string, IdReadings>): CardCorrection[] {
  const card = cardOf(metadata)
  if (!card) return []
  const out: CardCorrection[] = []
  for (const list of ['gave', 'got'] as const) {
    const assets = card[list]
    if (!Array.isArray(assets)) continue
    ;(assets as CardAsset[]).forEach((a, index) => {
      const id = cardAssetPlayerId(a)
      if (!id) return
      const readings = readingsById.get(id)
      if (!readings?.right) return
      const name = typeof a.name === 'string' ? a.name : null
      if (!isCrossSportName(name, readings)) return
      const wrong = readings.others.find((o) => normName(o.name) === normName(name))!
      out.push({
        list,
        index,
        playerId: id,
        stored: { name, position: typeof a.position === 'string' ? a.position : null },
        correct: { name: readings.right.name, position: readings.right.position, team: readings.right.team },
        wrongSport: wrong.sport,
      })
    })
  }
  return out
}

/**
 * The corrected metadata, and the message text with each wrong name replaced by the right one.
 * A wrong name the text does not contain EXACTLY once is left in the text and reported — guessing
 * which occurrence to rewrite in a posted message is not a repair.
 */
export function applyCardCorrections(
  metadata: unknown,
  text: string,
  corrections: readonly CardCorrection[],
): { metadata: unknown; text: string; textUnfixed: string[] } {
  if (corrections.length === 0) return { metadata, text, textUnfixed: [] }
  const copy = JSON.parse(JSON.stringify(metadata)) as { tradeCard: Record<'gave' | 'got', CardAsset[]> }
  let nextText = text
  const textUnfixed: string[] = []
  for (const c of corrections) {
    const a = copy.tradeCard?.[c.list]?.[c.index]
    if (a) {
      a.name = c.correct.name
      a.position = c.correct.position
      a.team = c.correct.team
    }
    const wrong = c.stored.name ?? ''
    const count = wrong ? nextText.split(wrong).length - 1 : 0
    if (count === 1 && c.correct.name) nextText = nextText.replace(wrong, c.correct.name)
    else if (wrong) textUnfixed.push(wrong)
  }
  return { metadata: copy, text: nextText, textUnfixed }
}

// ─── Imported-draft ADP ─────────────────────────────────────────────────────────────────────────

export type ResolvedPick = { name: string; position: string }

/**
 * Draft-fact player ids whose OLD (unscoped) resolution differs from the FIXED one, and the
 * `name|position` keys only the old resolution produced — the ADP rows that should not exist.
 * A key the fixed resolution also produces (another id resolving to that player) is not stale.
 */
export function staleAdpPlayers(
  ids: readonly string[],
  oldResolve: Map<string, ResolvedPick>,
  newResolve: Map<string, ResolvedPick>,
  /** How the ADP board keys a player — pass `buildPlayerKey`'s shape; plain `name|position` by default. */
  keyOf: (name: string, position: string) => string = (n, p) => `${n}|${p}`,
): { changedIds: Array<{ id: string; old: ResolvedPick; now: ResolvedPick | null }>; staleKeys: string[] } {
  const key = (p: ResolvedPick) => keyOf(p.name, p.position)
  const fixedKeys = new Set([...newResolve.values()].map(key))
  const changedIds: Array<{ id: string; old: ResolvedPick; now: ResolvedPick | null }> = []
  const stale = new Set<string>()
  for (const id of ids) {
    const old = oldResolve.get(id)
    if (!old) continue
    const now = newResolve.get(id) ?? null
    if (now && key(now) === key(old)) continue
    changedIds.push({ id, old, now })
    if (!fixedKeys.has(key(old))) stale.add(key(old))
  }
  return { changedIds, staleKeys: [...stale].sort() }
}

// ─── The write guard ────────────────────────────────────────────────────────────────────────────

/**
 * `--write` requires `--endpoint=<id>` naming the database the connection resolves to — the same
 * positive allowlist as `scripts/recalculate-af-format-markets.ts`. Returns why it refuses, or null.
 * `endpointMatches` is passed in so this stays pure.
 */
export function writeRefusal(
  argv: readonly string[],
  url: string | null | undefined,
  endpointMatches: (url: string | null | undefined, want: string) => boolean,
  resolved: string | null,
): string | null {
  if (!argv.includes('--write')) return null
  const want = (argv.find((a) => a.startsWith('--endpoint=')) ?? '').split('=')[1] ?? ''
  if (!want) return `REFUSING — --write requires --endpoint=${resolved ?? '<id>'} to confirm you mean this database.`
  if (!endpointMatches(url, want)) {
    return `REFUSING — you named "${want}"; the connection resolves to "${resolved ?? '(unresolved)'}".`
  }
  return null
}

/**
 * A text value as a jsonb literal for `jsonb_set` in the review SQL. 🛑 NULL is `'null'::jsonb`, never
 * `to_jsonb(NULL)`: that is SQL NULL, and `jsonb_set(doc, path, NULL)` returns NULL — the whole document.
 */
export function sqlJsonText(v: string | null | undefined): string {
  return v == null ? `'null'::jsonb` : `to_jsonb(${sqlLiteral(v)}::text)`
}

/** Postgres literal quoting for the printed review SQL (never executed). */
export function sqlLiteral(v: unknown): string {
  if (v == null) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

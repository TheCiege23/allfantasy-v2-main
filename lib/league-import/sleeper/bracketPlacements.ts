/**
 * Sleeper playoff brackets → who finished where.
 *
 * ── The bug this replaces ───────────────────────────────────────────────────
 *
 * ⚠ THE LAST ROUND IS NOT THE FINAL. Sleeper's `winners_bracket` puts every
 * placement game of a path in the same round: the title game (`p: 1`), the
 * third-place game (`p: 3`), and in bigger brackets the fifth- and seventh-place
 * games (`p: 5`, `p: 7`). Three readers each took "a game in the max round" as the
 * final:
 *
 *   `SleeperHistoricalMatchupSyncService.analyzePlayoffBracket` marked EVERY
 *   max-round winner champion and every loser runner-up — so a 6-team league
 *   recorded up to three champions and three runners-up per season.
 *   `syncLeagueHistory.parseChampionFromBracket` looked for `m === 1` (a
 *   bracket-wide match id, never 1 in the last round) and fell back to
 *   `finals[0]` — whichever placement game Sleeper happened to list first.
 *
 * `lib/league-history/sleeperLeagueHistoryService.ts` already did it right —
 * `bracket.find((n) => n.p === 1)` — and this module is that rule, shared.
 *
 * ── What `p` means ──────────────────────────────────────────────────────────
 *
 * `p` is the placement the WINNER of that game takes; the loser takes `p + 1`.
 * It is present only on placement games. Games without it are ordinary bracket
 * games (or consolation semifinals), and their winners go on to another game.
 *
 * ── When `p` is missing ────────────────────────────────────────────────────
 *
 * The metadata this repo stored before 2026-09-17 dropped `p` (and `t1_from` /
 * `t2_from`) when it flattened the bracket. For those, the title game is
 * INFERRED, and only when the inference is unambiguous: in the last round, the
 * one game whose two teams had not lost anywhere earlier in the bracket. If zero
 * or several games fit, nothing is inferred — a missing runner-up is honest, a
 * guessed one is the bug this file exists to remove.
 *
 * ⚠ PURE. No prisma, no fetch. Every caller hands in a bracket it already has.
 */

export type SleeperBracketGame = {
  /** Round, 1-based. */
  r?: number | null
  /** Match id — unique across the whole bracket, NOT per round. */
  m?: number | null
  t1?: number | null
  t2?: number | null
  /** Winner roster id; null until the game is decided. */
  w?: number | null
  /** Loser roster id; null until the game is decided. */
  l?: number | null
  /** Placement the winner takes (1 = title game). Absent on non-placement games. */
  p?: number | null
  /** Where team 1 came from: `{ w: m }` = winner of match m, `{ l: m }` = its loser. */
  t1_from?: { w?: number | null; l?: number | null } | null
  t2_from?: { w?: number | null; l?: number | null } | null
}

export type BracketPlacements = {
  championRosterId: number | null
  runnerUpRosterId: number | null
  /** Final placement for every roster a DECIDED placement game settled. */
  placementByRosterId: Map<number, number>
  /** The title game itself, or null when it cannot be identified. */
  titleGame: SleeperBracketGame | null
  /**
   * `placement` — read from `p`; `inferred` — no game carried `p`, and exactly
   * one last-round game had two teams that had not lost before; `none` — no title game.
   */
  source: 'placement' | 'inferred' | 'none'
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** A positive roster id, or null. Sleeper sends null/0 for an undecided slot. */
export function rosterIdOf(value: unknown): number | null {
  const n = num(value)
  return n > 0 ? n : null
}

function fromLoser(from: SleeperBracketGame['t1_from']): boolean {
  return from != null && from.l != null
}

/**
 * The title game when no game carries `p`.
 *
 * ⚠ ONLY WHEN EXACTLY ONE GAME FITS. A last-round game qualifies when neither of
 * its teams lost an earlier bracket game (a bye counts as not losing). The third-
 * and fifth-place games fail that by construction. When `t*_from` is present, a
 * game fed by a loser is excluded outright.
 */
function inferTitleGame(bracket: SleeperBracketGame[]): SleeperBracketGame | null {
  const maxRound = Math.max(0, ...bracket.map((g) => num(g.r)))
  if (maxRound <= 0) return null
  const lastRound = bracket.filter((g) => num(g.r) === maxRound)
  if (lastRound.length === 1) return lastRound[0]

  /*
   * ⚠ "NEVER LOST", NOT "WON ITS LAST GAME". In an 8-team bracket the fifth-place
   * game is also in the last round, and both of its teams WON their consolation
   * semifinal — they lost earlier, in the quarterfinal. Only the two finalists
   * reach the last round without a loss anywhere before it.
   */
  const lostBefore = (rosterId: number): boolean =>
    bracket.some((g) => num(g.r) < maxRound && rosterIdOf(g.l) === rosterId)

  const candidates = lastRound.filter((g) => {
    if (fromLoser(g.t1_from) || fromLoser(g.t2_from)) return false
    const a = rosterIdOf(g.t1)
    const b = rosterIdOf(g.t2)
    if (a == null || b == null) return false
    return !lostBefore(a) && !lostBefore(b)
  })
  return candidates.length === 1 ? candidates[0] : null
}

export function resolveBracketPlacements(bracket: readonly SleeperBracketGame[] | null | undefined): BracketPlacements {
  const games = Array.isArray(bracket) ? bracket.filter((g) => g && typeof g === 'object') : []
  const placementByRosterId = new Map<number, number>()

  for (const g of games) {
    const p = num(g.p)
    if (p <= 0) continue
    const w = rosterIdOf(g.w)
    const l = rosterIdOf(g.l)
    if (w != null) placementByRosterId.set(w, p)
    if (l != null) placementByRosterId.set(l, p + 1)
  }

  const withPlacement = games.filter((g) => num(g.p) > 0)
  let titleGame: SleeperBracketGame | null = null
  let source: BracketPlacements['source'] = 'none'
  if (withPlacement.length > 0) {
    titleGame = withPlacement.find((g) => num(g.p) === 1) ?? null
    if (titleGame) source = 'placement'
  } else {
    titleGame = inferTitleGame(games)
    if (titleGame) source = 'inferred'
  }

  const championRosterId = titleGame ? rosterIdOf(titleGame.w) : null
  const runnerUpRosterId = titleGame ? rosterIdOf(titleGame.l) : null
  if (source === 'inferred') {
    if (championRosterId != null) placementByRosterId.set(championRosterId, 1)
    if (runnerUpRosterId != null) placementByRosterId.set(runnerUpRosterId, 2)
  }

  return { championRosterId, runnerUpRosterId, placementByRosterId, titleGame, source }
}

export type PlayoffFinishInfo = {
  isChampion: boolean
  isRunnerUp: boolean
  /** Wins on the path to the title — placement and consolation games do not count. */
  playoffWins: number
  playoffLosses: number
  /** 1 = champion; 999 = no playoff appearance. */
  bestFinish: number
  madePlayoffs: boolean
}

/**
 * The earliest round each roster lost in — a team that has lost is off the title
 * path from then on, whatever game it plays next.
 */
function firstLossRound(games: readonly SleeperBracketGame[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const g of games) {
    const l = rosterIdOf(g.l)
    if (l == null) continue
    const r = num(g.r)
    const held = out.get(l)
    if (held == null || r < held) out.set(l, r)
  }
  return out
}

/**
 * Whether a game is on the path to the title: not a placement game for anything
 * below first, not fed by a loser, and neither team already beaten in an earlier
 * round. The last test is what keeps consolation games out when the stored bracket
 * lost its `t*_from` links.
 *
 * The `p > 1` test is redundant with it — a game for third place or lower is only
 * ever played by teams that already lost — and is kept so that intent reads here
 * rather than having to be derived. A mutation run confirmed the equivalence.
 */
function onTitlePath(g: SleeperBracketGame, lostIn: Map<number, number>): boolean {
  const p = num(g.p)
  if (p > 1) return false
  if (fromLoser(g.t1_from) || fromLoser(g.t2_from)) return false
  const r = num(g.r)
  for (const t of [rosterIdOf(g.t1), rosterIdOf(g.t2)]) {
    if (t == null) continue
    const lost = lostIn.get(t)
    if (lost != null && lost < r) return false
  }
  return true
}

/**
 * Per-roster playoff finish, as the historical matchup sync stores it.
 *
 * - Exactly one champion and one runner-up, from the title game.
 * - `bestFinish` is the settled placement when a placement game decided it;
 *   otherwise, for a team knocked out on the title path in round `r`, the first
 *   place that elimination leaves open: 2^(titleRound − r) + 1.
 * - `playoffWins` / `playoffLosses` count title-path games only — a win in the
 *   fifth-place game is not a playoff win.
 */
export function analyzePlayoffBracket(
  bracket: readonly SleeperBracketGame[] | null | undefined,
  rosterIds: readonly number[],
): Map<number, PlayoffFinishInfo> {
  const results = new Map<number, PlayoffFinishInfo>()
  for (const rosterId of rosterIds) {
    results.set(rosterId, {
      isChampion: false,
      isRunnerUp: false,
      playoffWins: 0,
      playoffLosses: 0,
      bestFinish: 999,
      madePlayoffs: false,
    })
  }

  const games = Array.isArray(bracket) ? bracket : []
  if (games.length === 0) return results

  const placements = resolveBracketPlacements(games)
  const lostIn = firstLossRound(games)
  const titleRound = placements.titleGame
    ? num(placements.titleGame.r)
    : Math.max(0, ...games.filter((g) => onTitlePath(g, lostIn)).map((g) => num(g.r)))

  for (const g of games) {
    for (const t of [rosterIdOf(g.t1), rosterIdOf(g.t2)]) {
      const info = t != null ? results.get(t) : undefined
      if (info) info.madePlayoffs = true
    }
    if (!onTitlePath(g, lostIn)) continue
    const w = rosterIdOf(g.w)
    const l = rosterIdOf(g.l)
    const winner = w != null ? results.get(w) : undefined
    const loser = l != null ? results.get(l) : undefined
    if (winner) winner.playoffWins += 1
    if (loser) {
      loser.playoffLosses += 1
      if (g !== placements.titleGame && titleRound > 0) {
        const finish = Math.pow(2, Math.max(0, titleRound - num(g.r))) + 1
        loser.bestFinish = Math.min(loser.bestFinish, finish)
      }
    }
  }

  for (const [rosterId, info] of results) {
    const settled = placements.placementByRosterId.get(rosterId)
    if (settled != null) info.bestFinish = settled
    if (rosterId === placements.championRosterId) {
      info.isChampion = true
      info.bestFinish = 1
    }
    if (rosterId === placements.runnerUpRosterId) {
      info.isRunnerUp = true
      info.bestFinish = 2
    }
    if (!info.isChampion && info.madePlayoffs && info.bestFinish === 999) {
      info.bestFinish = rosterIds.length
    }
  }

  return results
}

/* ── Reading what the historical sync stored ─────────────────────────────────── */

/** A title game as read back from `league_dynasty_seasons.metadata.playoffStructure`. */
export type StoredTitleGame = {
  championRosterId: number
  runnerUpRosterId: number | null
  /** `stored` — the row's own `championRosterId` (bracketPlacementVersion 2); otherwise how the stored bracket resolved. */
  source: 'stored' | 'placement' | 'inferred'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function nullableNum(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function storedFrom(value: unknown): SleeperBracketGame['t1_from'] {
  const r = asRecord(value)
  return r ? { w: nullableNum(r.w), l: nullableNum(r.l) } : null
}

/**
 * The bracket as `SleeperHistoricalMatchupSyncService.toPlainBracket` stored it
 * (`round`, `matchup`, `team1`, …), back in Sleeper's own field names.
 */
export function storedBracketGames(playoffStructure: unknown): SleeperBracketGame[] {
  const raw = asRecord(playoffStructure)?.winnersBracket
  if (!Array.isArray(raw)) return []
  return raw
    .map(asRecord)
    .filter((g): g is Record<string, unknown> => g != null)
    .map((g) => ({
      r: nullableNum(g.round),
      m: nullableNum(g.matchup),
      t1: nullableNum(g.team1),
      t2: nullableNum(g.team2),
      w: nullableNum(g.winner),
      l: nullableNum(g.loser),
      p: nullableNum(g.placement),
      t1_from: storedFrom(g.team1From),
      t2_from: storedFrom(g.team2From),
    }))
}

/**
 * The decided title game of a stored season, or null when there is none to read.
 *
 * ⚠ OLD ROWS ARE RESOLVED HERE, NOT LEFT FOR A BACKFILL. The sync skips a season that is
 * complete and already stored, so a row written before `bracketPlacementVersion: 2` keeps
 * its old metadata indefinitely. Its flattened bracket is still there, and this resolves it
 * with the same rule the writer now uses. A version-2 row is read as stored.
 */
export function readStoredTitleGame(playoffStructure: unknown): StoredTitleGame | null {
  const ps = asRecord(playoffStructure)
  if (!ps) return null
  if (ps.bracketPlacementVersion === 2) {
    const championRosterId = rosterIdOf(ps.championRosterId)
    if (championRosterId == null) return null
    return { championRosterId, runnerUpRosterId: rosterIdOf(ps.runnerUpRosterId), source: 'stored' }
  }
  const resolved = resolveBracketPlacements(storedBracketGames(ps))
  if (resolved.championRosterId == null || resolved.source === 'none') return null
  return {
    championRosterId: resolved.championRosterId,
    runnerUpRosterId: resolved.runnerUpRosterId,
    source: resolved.source,
  }
}

/**
 * The historical roster id that became `canonicalId` (the current season's team id),
 * from the stored `canonicalRosterIdByHistoricalRosterId`.
 *
 * ⚠ ONLY AN UNAMBIGUOUS MATCH. The sync maps a roster whose manager has left to its own
 * historical id, so two historical rosters can share a canonical id. When they do, this
 * returns null rather than picking one — attributing another manager's final to you is
 * the failure this whole module exists to prevent.
 */
export function storedHistoricalRosterId(playoffStructure: unknown, canonicalId: string | null | undefined): number | null {
  if (!canonicalId) return null
  const map = asRecord(asRecord(playoffStructure)?.canonicalRosterIdByHistoricalRosterId)
  if (!map) return null
  const matches = Object.entries(map)
    .filter(([, canonical]) => String(canonical) === String(canonicalId))
    .map(([historical]) => rosterIdOf(historical))
    .filter((id): id is number => id != null)
  return matches.length === 1 ? matches[0] : null
}

/** The label the historical sync stores beside each finish. */
export function placementLabel(info: PlayoffFinishInfo): string | null {
  if (info.isChampion) return 'Champion'
  if (info.isRunnerUp) return 'Runner-up'
  if (info.bestFinish <= 4) return 'Semifinalist'
  if (info.madePlayoffs) return 'Playoff Team'
  return null
}

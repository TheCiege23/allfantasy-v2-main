import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Layer 2 — trajectory. Where a player is going, not where he has been.
 *
 * ⚠ AGE IS READ OUT OF THE MARKET RATHER THAN APPLIED TO IT, and that is the
 * whole trick. FantasyCalc publishes BOTH a dynasty and a redraft price for the
 * same player, and the spread between them IS the market's opinion of his
 * future. A 23-year-old is worth far more in dynasty than in redraft; a
 * 31-year-old is worth less. Nothing has to be assumed about ageing curves,
 * because the number already contains one.
 *
 * That also fixes the double-counting problem this factor was blocked on. An age
 * curve applied on top of a dynasty price re-charges a player for something the
 * price already reflects. A RATIO between two prices from the same source cannot
 * double-count, because it is a comparison rather than an adjustment.
 *
 * ⚠ AND IT IS NOT PURELY AGE, which is worth saying plainly. The spread carries
 * age, situation, contract, injury history and whatever else the market believes
 * about a player's future — all of it, mixed. That makes it a better trajectory
 * signal than age alone and a worse one than a clean age number, and a manager
 * reading "the market sees him as a rising asset" deserves to know it is the
 * market's whole opinion rather than a birth date.
 */

export type FutureLean = {
  dynastyValue: number
  redraftValue: number
  /** Above 1 = market pays a premium for his future. */
  ratio: number
  direction: 'rising' | 'flat' | 'declining'
  basis: string
}

/** Inside this band the two prices agree and there is nothing to report. */
const FLAT_BAND = 0.12

/**
 * The market's own view of a player's future, from the dynasty/redraft spread.
 *
 * Both prices must be from the same capture and the same QB format, or the ratio
 * measures the format difference instead of the player.
 */
export function futureLean(args: {
  dynastyValue: number | null
  redraftValue: number | null
  playerName?: string
}): FutureLean | null {
  const { dynastyValue, redraftValue } = args
  if (dynastyValue == null || redraftValue == null) return null
  if (dynastyValue <= 0 || redraftValue <= 0) return null

  const ratio = dynastyValue / redraftValue
  const who = args.playerName ?? 'He'

  const direction: FutureLean['direction'] =
    ratio > 1 + FLAT_BAND ? 'rising' : ratio < 1 - FLAT_BAND ? 'declining' : 'flat'

  return {
    dynastyValue,
    redraftValue,
    ratio,
    direction,
    basis:
      direction === 'rising'
        ? `The market prices ${who.toLowerCase() === 'he' ? 'him' : who} ${Math.round(
            (ratio - 1) * 100,
          )}% higher in dynasty than in redraft — it is paying for his future, not just this season. You are buying the years as much as the player.`
        : direction === 'declining'
          ? `The market prices ${who.toLowerCase() === 'he' ? 'him' : who} ${Math.round(
              (1 - ratio) * 100,
            )}% LOWER in dynasty than in redraft — it expects this season to be near the top of what is left. Fine if you are contending; expensive if you are not.`
          : `Dynasty and redraft prices agree on ${
              who.toLowerCase() === 'he' ? 'him' : who
            }, so the market sees no meaningful future premium or discount either way.`,
  }
}

/**
 * Load both prices for a set of players, matched on capture and QB format.
 *
 * ⚠ MATCHED, NOT MERELY BOTH-FETCHED. Comparing a dynasty superflex price to a
 * redraft one-QB price would report every quarterback as a rising asset, which
 * is a format artefact wearing a trajectory's clothes.
 */
export async function loadFutureLeans(args: {
  sleeperIds: string[]
  qbFormat: 'ONE_QB' | 'SUPERFLEX'
}): Promise<Map<string, FutureLean>> {
  const out = new Map<string, FutureLean>()
  if (args.sleeperIds.length === 0) return out

  const rows = await prisma.playerValueSnapshot
    .findMany({
      where: {
        sleeperId: { in: args.sleeperIds },
        source: 'FANTASYCALC',
        qbFormat: args.qbFormat,
      },
      orderBy: { capturedAt: 'desc' },
      select: { sleeperId: true, format: true, value: true, name: true },
    })
    .catch(() => [])

  const dyn = new Map<string, { value: number; name: string }>()
  const red = new Map<string, { value: number; name: string }>()
  for (const r of rows) {
    const bucket = r.format === 'DYNASTY' ? dyn : r.format === 'REDRAFT' ? red : null
    if (bucket && !bucket.has(r.sleeperId)) bucket.set(r.sleeperId, { value: r.value, name: r.name })
  }

  for (const [id, d] of dyn) {
    const r = red.get(id)
    if (!r) continue
    const lean = futureLean({
      dynastyValue: d.value,
      redraftValue: r.value,
      playerName: d.name,
    })
    if (lean) out.set(id, lean)
  }
  return out
}

export type UsageSignal = {
  games: number
  /** Share of team offensive snaps, when the stat is present. */
  snapShare: number | null
  targetsPerGame: number | null
  rushAttemptsPerGame: number | null
  /** Rushes as a share of rushes + targets. */
  runShare: number | null
  role: 'runner' | 'receiver' | 'dual' | null
  basis: string
}

/**
 * How a player is actually being used, from his own box scores.
 *
 * ⚠ THIS IS THE FACTOR MOST LIKELY TO BE ABSENT, and absence must not read as
 * zero. Snap counts cover roughly 77–89% of rows and targets around 58%, so a
 * player with no `off_snp` is usually a coverage gap rather than a man who did
 * not play. Every field here is null-if-missing and the note names what it
 * could not see.
 *
 * ⚠ THIRD-DOWN ROLE IS NOT DERIVABLE FROM THIS DATA and is deliberately absent.
 * Box scores carry totals, not down-and-distance splits. A "third-down back"
 * signal invented from a target count would be a guess dressed as a role, and
 * it is exactly the kind of number a manager would trade on.
 */
export async function loadUsage(args: {
  /** Sleeper ids, matching PlayerGameStat.playerId. */
  playerIds: string[]
  season: number
  /** Only the most recent N games, so a role change is visible. */
  lastGames?: number
}): Promise<Map<string, UsageSignal>> {
  const out = new Map<string, UsageSignal>()
  if (args.playerIds.length === 0) return out
  const window = args.lastGames ?? 5

  const rows = await prisma.playerGameStat
    .findMany({
      where: { playerId: { in: args.playerIds }, season: args.season },
      orderBy: { weekOrRound: 'desc' },
      select: { playerId: true, normalizedStatMap: true, weekOrRound: true },
      take: args.playerIds.length * (window + 4),
    })
    .catch(() => [])

  const byPlayer = new Map<string, Array<Record<string, unknown>>>()
  for (const r of rows) {
    const list = byPlayer.get(r.playerId) ?? []
    if (list.length >= window) continue
    const map = (r.normalizedStatMap ?? {}) as Record<string, unknown>
    list.push(map)
    byPlayer.set(r.playerId, list)
  }

  const num = (m: Record<string, unknown>, ...keys: string[]): number | null => {
    for (const k of keys) {
      const v = m[k]
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
    }
    return null
  }

  /** Mean over the games that actually carried the stat, not over all games. */
  const meanOf = (games: Array<Record<string, unknown>>, keys: string[]): number | null => {
    const vals = games.map((g) => num(g, ...keys)).filter((v): v is number => v != null)
    if (vals.length === 0) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }

  for (const [playerId, games] of byPlayer) {
    if (games.length === 0) continue

    const snaps = meanOf(games, ['off_snp', 'offensive_snaps', 'snaps'])
    const teamSnaps = meanOf(games, ['tm_off_snp', 'team_off_snp'])
    const targets = meanOf(games, ['rec_tgt', 'targets'])
    const rushes = meanOf(games, ['rush_att', 'rushing_attempts'])

    const snapShare =
      snaps != null && teamSnaps != null && teamSnaps > 0
        ? Math.min(1, snaps / teamSnaps)
        : null

    const touches = (targets ?? 0) + (rushes ?? 0)
    const runShare = targets != null && rushes != null && touches > 0 ? rushes / touches : null
    const role: UsageSignal['role'] =
      runShare == null ? null : runShare >= 0.7 ? 'runner' : runShare <= 0.3 ? 'receiver' : 'dual'

    const missing: string[] = []
    if (snapShare == null) missing.push('snap share')
    if (targets == null) missing.push('targets')

    out.set(playerId, {
      games: games.length,
      snapShare,
      targetsPerGame: targets,
      rushAttemptsPerGame: rushes,
      runShare,
      role,
      basis: [
        `Across his last ${games.length} game${games.length === 1 ? '' : 's'}:`,
        snapShare != null ? ` ${Math.round(snapShare * 100)}% of snaps.` : '',
        targets != null ? ` ${targets.toFixed(1)} targets a game.` : '',
        rushes != null ? ` ${rushes.toFixed(1)} carries.` : '',
        role === 'runner'
          ? ' Used as a runner.'
          : role === 'receiver'
            ? ' Used as a receiver.'
            : role === 'dual'
              ? ' Used both ways.'
              : '',
        missing.length > 0
          ? ` We hold no ${missing.join(' or ')} for him — that is a coverage gap, not a zero.`
          : '',
      ]
        .join('')
        .trim(),
    })
  }

  return out
}

/**
 * Experience, which is now durably held.
 *
 * ⚠ IT WAS NEVER MISSING FROM THE FEED, ONLY FROM THE WRITE. Sleeper sends
 * `years_exp` and `SleeperPlayerSeedService` has always parsed it into its
 * `SeededPlayer` type — there was simply no column to put it in, so it was
 * dropped at the createMany. `SportsPlayer.yearsExp` exists now and the seed
 * passes it through.
 *
 * ⚠ 0 AND NULL ARE DIFFERENT AND THE DIFFERENCE IS THE WHOLE FACTOR. 0 means
 * he has not played an NFL snap. NULL means we do not know. Reading null as 0
 * labels every player we failed to match a rookie — the most confident possible
 * wrong answer about the class of asset dynasty managers pay the biggest
 * premium for.
 */
export type ExperienceSignal = {
  yearsExp: number
  rookie: boolean
}

/** Still true for a player with no row, or a row the seed has not refreshed. */
export const EXPERIENCE_GAP =
  'Years of experience are not on file for this player, so rookie status cannot be confirmed here.'

/**
 * Experience by player NAME, because the notes builder works from lines rather
 * than ids.
 *
 * ⚠ AMBIGUITY IS RESOLVED ON THE VALUE, NOT THE ROW COUNT. `SportsPlayer` is
 * unique on `(sport, externalId, source)`, so one player legitimately appears
 * once per source and a name matching several rows is normal. What matters is
 * whether those rows AGREE: if they do, the figure is safe; if two sources
 * disagree about how many seasons a man has played, we do not get to pick one.
 */
export async function loadExperience(args: {
  names: string[]
  sport: string
}): Promise<Map<string, ExperienceSignal>> {
  const out = new Map<string, ExperienceSignal>()
  const names = [...new Set(args.names.map((n) => n.trim()).filter(Boolean))]
  if (names.length === 0) return out

  const rows = await prisma.sportsPlayer
    .findMany({
      where: { sport: args.sport, name: { in: names } },
      select: { name: true, yearsExp: true },
    })
    .catch(() => [])

  const byName = new Map<string, Set<number>>()
  const sawNull = new Set<string>()
  for (const r of rows) {
    const key = r.name.toLowerCase()
    if (r.yearsExp == null) {
      sawNull.add(key)
      continue
    }
    const set = byName.get(key) ?? new Set<number>()
    set.add(r.yearsExp)
    byName.set(key, set)
  }

  for (const [key, values] of byName) {
    /* Two sources disagreeing is a reason to say nothing, not to average them. */
    if (values.size !== 1) continue
    const yearsExp = [...values][0]!
    out.set(key, { yearsExp, rookie: yearsExp === 0 })
  }
  /* A name whose only rows carry null stays absent — unknown, not zero. */
  for (const key of sawNull) if (!out.has(key)) out.delete(key)

  return out
}

/**
 * The note, for a player arriving on the viewer's roster.
 *
 * ⚠ ONLY THE ROOKIE CASE SPEAKS. "He is in his fourth season" is true and
 * changes nothing a manager would do, and a panel that lists every non-finding
 * is one people stop reading — the same rule the depth-role and leverage notes
 * follow.
 *
 * ⚠ AND IT REPORTS, IT DOES NOT REPRICE. FantasyCalc's dynasty price already
 * carries rookie hype; an adjustment on top would double-count it, exactly as an
 * age curve would. What the note adds is what the number IS, not a correction
 * to it.
 */
export function experienceNote(name: string, signal: ExperienceSignal | null): string | null {
  if (!signal || !signal.rookie) return null
  return `${name} has not played an NFL snap. His price is a projection of what he might become, not a record of what he has done.`
}

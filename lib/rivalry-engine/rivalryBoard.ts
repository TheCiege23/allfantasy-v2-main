import 'server-only'

/**
 * 11d — board-ready rivalry rows: named teams, justifying stat chips, one line
 * of context.
 *
 * `listRivalries()` already returns the ranked pairs and their scores, and that
 * is all the existing GET hands back. It is not enough to render this screen
 * honestly, for two reasons:
 *
 *   1. It returns `managerAId` / `managerBId` — the platform's external team ids.
 *      A card headed `464812...` vs `981233...` is not a rivalry card.
 *   2. Handoff build rule 1: a rivalry score never ships as a bare number. The
 *      chips that justify it (meetings, close games, eliminations) live in
 *      `RivalryEvent` rows that nothing was reading.
 *
 * ⚠ THE COUNTS COME OUT OF `description`, AND THAT IS A COMPROMISE WORTH KNOWING
 * ABOUT. `RivalryEvent` has no numeric column — `RivalryEngine.runRivalryEngine`
 * writes the count into the description string (`"14 total head-to-head
 * matchups"`). Reading a number back out of a display string is normally the
 * exact anti-pattern this codebase calls out, so two things keep it safe here:
 * the string is written by our own engine three files away rather than by a
 * provider, and when the leading integer does not parse the raw description is
 * rendered instead of a fabricated number. A chip never shows a count we did not
 * read.
 *
 * The durable fix is a numeric column on `RivalryEvent`; that is a migration and
 * this screen does not need to block on one.
 */

import { prisma } from '@/lib/prisma'

export type RivalryChipTone = 'neutral' | 'warn'

export type RivalryChip = {
  label: string
  /**
   * ⚠ ONLY GENUINELY RARE STATS ARE TINTED. Build rule 2. Eliminations and
   * championship clashes are rare and high-stakes; meetings, close games,
   * trades and upsets are routine. Tinting the routine ones is how the eye stops
   * finding the one that matters.
   */
  tone: RivalryChipTone
}

export type RivalryBoardRow = {
  id: string
  teamAName: string
  teamBName: string
  rivalryScore: number
  tier: string
  chips: RivalryChip[]
  /** Head-to-head record sentence, when a streak event recorded one. */
  context: string | null
}

export type RivalryBoard = {
  leagueId: string
  rows: RivalryBoardRow[]
  /**
   * Distinct seasons of head-to-head history behind these scores — the header's
   * "N seasons of head-to-head".
   *
   * ⚠ COUNTED FROM `MatchupFact`, NOT FROM `RivalryEvent.season`. The obvious
   * source is wrong: `runRivalryEngine` stamps every event it writes with
   * `Math.max(...seasons)`, so a rivalry built from four seasons carries four
   * events that all say 2025. Deriving the span from events therefore always
   * reported "1 season" — measured against a real four-season league.
   */
  seasonsCovered: number
}

/** Short, uppercase chip labels keyed off the engine's own event types. */
const CHIP_SPEC: Record<string, { noun: string; tone: RivalryChipTone }> = {
  h2h_matchup: { noun: 'H2H MEETINGS', tone: 'neutral' },
  close_game: { noun: 'CLOSE GAMES', tone: 'neutral' },
  playoff_matchup: { noun: 'PLAYOFF MEETINGS', tone: 'neutral' },
  elimination: { noun: 'ELIMINATION', tone: 'warn' },
  championship_clash: { noun: 'CHAMPIONSHIP CLASH', tone: 'warn' },
  upset_win: { noun: 'UPSET WINS', tone: 'neutral' },
  trade: { noun: 'TRADES', tone: 'neutral' },
  drama: { noun: 'DRAMA FLAGS', tone: 'neutral' },
}

/** Order chips read in: volume, then closeness, then stakes. Stakes land last so they are the eye's rest point. */
const CHIP_ORDER = [
  'h2h_matchup',
  'close_game',
  'upset_win',
  'trade',
  'drama',
  'playoff_matchup',
  'elimination',
  'championship_clash',
]

function leadingCount(description: string | null): number | null {
  if (!description) return null
  const m = /^\s*(\d+)\b/.exec(description)
  if (!m) return null
  const n = Number.parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** "14 H2H MEETINGS" — singularised so a lone elimination does not read "1 ELIMINATIONS". */
function chipLabel(count: number, noun: string): string {
  if (count === 1) {
    const singular = noun.endsWith('ES') ? noun.slice(0, -2) : noun.endsWith('S') ? noun.slice(0, -1) : noun
    return `1 ${singular}`
  }
  return `${count} ${noun}`
}

export async function getRivalryBoard(leagueId: string, limit = 8): Promise<RivalryBoard> {
  const empty: RivalryBoard = { leagueId, rows: [], seasonsCovered: 0 }
  if (!leagueId) return empty

  const records = await prisma.rivalryRecord
    .findMany({
      where: { leagueId },
      orderBy: [{ rivalryScore: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      include: { events: { select: { eventType: true, description: true, season: true } } },
    })
    .catch(() => [])

  if (records.length === 0) return empty

  /*
   * Identity. `RivalryEngine` aggregates with `useTeamIds: true`, so the manager
   * ids on these records are `LeagueTeam.externalId` values. A team we cannot
   * name is rendered as its own id rather than dropped — a missing row on one
   * side should not silently delete a real rivalry from the board.
   */
  const teams = await prisma.leagueTeam
    .findMany({ where: { leagueId }, select: { externalId: true, teamName: true, ownerName: true } })
    .catch(() => [] as Array<{ externalId: string; teamName: string; ownerName: string }>)
  const nameById = new Map(teams.map((t) => [t.externalId, t.teamName?.trim() || t.ownerName?.trim() || t.externalId]))

  const rows: RivalryBoardRow[] = records.map((r) => {
    const byType = new Map<string, { description: string | null }>()
    for (const e of r.events) {
      if (!byType.has(e.eventType)) byType.set(e.eventType, { description: e.description })
    }

    const chips: RivalryChip[] = []
    for (const type of CHIP_ORDER) {
      const spec = CHIP_SPEC[type]
      const event = byType.get(type)
      if (!spec || !event) continue
      const count = leadingCount(event.description)
      chips.push({
        // Fall back to the engine's own sentence rather than inventing a number.
        label: count != null ? chipLabel(count, spec.noun) : (event.description ?? spec.noun),
        tone: spec.tone,
      })
    }

    /*
     * The context sentence. `streak` is the only event carrying a record, and its
     * description leads with a raw team id — swap in the resolved name so the
     * line reads as English. If it does not resolve, the sentence is dropped
     * rather than shown with an id in it.
     */
    const streak = r.events.find((e) => e.eventType === 'streak')?.description ?? null
    let context: string | null = null
    if (streak) {
      const idMatch = /^(\S+)\s+holds/.exec(streak)
      const resolved = idMatch ? nameById.get(idMatch[1]) : undefined
      if (resolved) context = streak.replace(idMatch![1], resolved)
    }

    return {
      id: r.id,
      teamAName: nameById.get(r.managerAId) ?? r.managerAId,
      teamBName: nameById.get(r.managerBId) ?? r.managerBId,
      rivalryScore: Math.round(r.rivalryScore),
      tier: r.rivalryTier,
      chips,
      context,
    }
  })

  // The real span of played history behind these scores. See the type's note.
  const seasonRows = await prisma.matchupFact
    .findMany({ where: { leagueId }, select: { season: true }, distinct: ['season'] })
    .catch(() => [] as Array<{ season: number | null }>)
  const seasonsCovered = new Set(seasonRows.map((r) => r.season).filter((s): s is number => typeof s === 'number')).size

  return { leagueId, rows, seasonsCovered }
}

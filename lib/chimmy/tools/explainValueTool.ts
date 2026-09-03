import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { findAfProjectionsByName } from '@/lib/af-projections/readAfProjections'
import { explainPlayerValue } from '@/lib/trade-value/valueEngine'

/**
 * Why a player is worth what he is worth — the full derivation chain. Phase 7.3.
 *
 * ── HOW THIS DIFFERS FROM `get_player_value` ───────────────────────────────────────────────
 * That tool answers "what is he worth" and reads the PUBLISHED market board — a number computed
 * elsewhere and stored. This one answers "why", and it runs the engine live over the inputs it
 * can see, showing each step. They can legitimately disagree, and when they do that is a finding
 * rather than a bug: the published board is a periodic snapshot and this is the current inputs.
 * Said in the output rather than smoothed over.
 *
 * ── 🛑 THE ARITHMETIC IS NOT REIMPLEMENTED HERE ────────────────────────────────────────────
 * `explainPlayerValue` lives in the engine and `normalizedPlayerValue` returns its `.value`, so
 * the explanation and the price are the same computation by construction. An explainer that
 * re-walked the formula would drift the first time either side changed — silently, because an
 * explanation that disagrees with a price still reads perfectly.
 *
 * ── ⚠ NO LEAGUE, SO NO LEAGUE-SPECIFIC SCARCITY ────────────────────────────────────────────
 * Same rule as its neighbours: no league id crosses the model boundary. The consequence is real
 * and is stated in the output — without a league the scarcity term is the default, so the number
 * here is a general-market derivation, not what the player is worth in the user's league.
 */

const SPORTS = new Set(['NFL', 'NCAAF', 'NBA', 'MLB', 'NHL', 'NCAABB', 'SOCCER'])

function notFound(asked: string): string {
  return [
    `NOTHING TO EXPLAIN FOR "${asked}" — no projection and no published value matched that name.`,
    'This is NOT a finding that the player is worthless or unknown to AllFantasy, and you must NOT',
    'say either. You must NOT invent a derivation or a number from general knowledge; a made-up',
    'explanation is worse than a made-up value, because it looks like evidence.',
    'Say we have nothing on file to derive a value from, and offer to check the spelling.',
  ].join(' ')
}

export async function buildExplainValueContext(args: {
  playerName: string
  sport?: string | null
}): Promise<string> {
  const asked = args.playerName.trim()
  if (!asked) {
    return 'No player name was given, so nothing was looked up. Ask the user which player they mean.'
  }

  const sport = (args.sport ?? 'NFL').trim().toUpperCase()
  if (!SPORTS.has(sport)) {
    return `"${sport}" is not a sport AllFantasy values. Say so; do not explain a number for it.`
  }

  const target = normalizePlayerName(asked)
  if (!target) return notFound(asked)

  /*
   * Both inputs the engine can take, fetched together. The projection is the primary basis; the
   * published market value is the fallback the engine uses when there is no projection.
   */
  const [proj, published] = await Promise.all([
    findAfProjectionsByName({ playerName: asked, sport }).catch(() => ({ rows: [], season: null })),
    prisma.allFantasyMarketPlayerValue
      .findMany({
        where: { published: true, sport },
        select: { playerName: true, position: true, marketValue: true, leagueConcept: true },
        orderBy: { marketValue: 'desc' },
      })
      .catch(() => [] as Array<{ playerName: string | null; position: string | null; marketValue: number; leagueConcept: string | null }>),
  ])

  const row = proj.rows[0] ?? null
  const board = published.filter((p) => normalizePlayerName(String(p.playerName ?? '')) === target)

  if (!row && board.length === 0) return notFound(asked)

  const position = row?.position ?? board[0]?.position ?? null
  const displayName = row?.playerName ?? board[0]?.playerName ?? asked

  /*
   * ⚠ ONLY `rosProjection` FEEDS THE ENGINE, NEVER `afProjection`. The engine expects a
   * REST-OF-SEASON total; the per-game number is a different unit and substituting it understates
   * a player by roughly the weeks remaining. A row without a ROS total is not converted here
   * against a guessed horizon — it is reported as missing.
   */
  const derivation = explainPlayerValue({
    projection: row?.rosProjection ?? null,
    position,
    adp: null,
    marketValue: board[0]?.marketValue ?? null,
    idpValue: null,
  })

  const lines: string[] = [
    `Derivation for ${displayName}${position ? ` (${position})` : ''}, ${sport}:`,
  ]

  if (row && row.rosProjection == null) {
    lines.push(
      `⚠ ${displayName} has a per-game projection (${row.afProjection.toFixed(1)}) but NO rest-of-season total, and the value engine takes a rest-of-season number. Do NOT multiply the per-game figure yourself — the weeks remaining and his bye are not here. The derivation below therefore used no projection.`,
    )
  }

  derivation.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.label} → ${Math.round(s.value).toLocaleString()}`)
    lines.push(`   ${s.detail}`)
  })

  lines.push(
    `Result: ${derivation.value.toLocaleString()} on the AllFantasy 0-10000 scale, priced from ${derivation.basis}.`,
  )

  /*
   * ⚠ THE TWO NUMBERS CAN DISAGREE, AND THAT IS INFORMATION. The published board is a periodic
   * snapshot; this is the current inputs run through the engine now. Presenting only one, or
   * quietly preferring one, hides a staleness signal the user can act on.
   */
  if (board.length > 0 && derivation.basis !== 'market') {
    const b = board[0]
    if (Math.abs(b.marketValue - derivation.value) > 1) {
      lines.push(
        `⚠ The PUBLISHED market value for him is ${b.marketValue.toLocaleString()}${b.leagueConcept ? ` (${b.leagueConcept})` : ''}, which differs from this derivation. Both are real: the published figure is a stored snapshot, this one is the current inputs run through the engine. Report both and say which is which rather than picking one.`,
      )
    }
  }

  /*
   * ⚠ THE LIMIT THAT MOST CHANGES THE ANSWER, stated rather than buried. Positional scarcity is
   * computed from a league's real starting slots; with no league it falls back to the default, so
   * a superflex QB or a TE-premium tight end is under-priced here relative to the user's league.
   */
  lines.push(
    'NOTE THE LIMIT: this derivation uses default positional scarcity, because this tool takes no league. In a superflex, 2QB or TE-premium league the real number is higher for those positions. Say so if the user asks what he is worth in THEIR league.',
  )

  return lines.join('\n')
}

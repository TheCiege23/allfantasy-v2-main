import 'server-only'

import { looksLikeSleeperExternalId } from '@/lib/draft-sports-models/player-asset-resolver'
import { sleeperHeadshotUrl } from '@/lib/player-media-urls'
import type { SupportedSport } from '@/lib/sport-scope'
import type { LeagueGroundingRoster } from '@/lib/ai/leagueSportsGroundingPacket'

/**
 * PLAYER CARDS FOR A CHIMMY ANSWER — name, position, team and a headshot for
 * every player the answer actually names.
 *
 * ⚠ THE CANDIDATE SET IS THE USER'S OWN ROSTER, NOT THE PLAYER TABLE. Matching
 * an answer's prose against 13,010 NFL players by name would be a coin flip:
 * duplicate names are real (a production dedupe pass merged ~900 of them), and
 * the wrong face beside a start/sit call is worse than no face. Restricting the
 * candidates to the roster Chimmy was grounded on makes a name match safe,
 * because that set is small, known, and the only players an answer about "your
 * team" should be illustrating anyway.
 *
 * ⚠ THE IMAGE IS DERIVED, NOT JOINED. `Player.id` is a slug
 * (`nfl-mante-morrow-a50bced6`); roster player ids are Sleeper numerics (`5859`)
 * or synthetic name keys (`name:Brian Thomas Jr.:WR:JAX`). Measured against
 * production 2026-08-25 the two spaces overlap on ZERO of 205 roster rows, so
 * there is no id join to make here — `sleeperHeadshotUrl` derives the CDN URL
 * from the Sleeper id directly, which is what the draft room already does.
 * Anything else resolves to null and the UI falls back to initials.
 */

export type ChimmyPlayerCard = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  /** null is a legitimate outcome — the UI renders initials. Never a placeholder URL. */
  imageUrl: string | null
  isStarter: boolean
}

/** Beyond this the answer is not really "about" these players any more. */
const MAX_CARDS = 6

/**
 * Case-insensitive presence test for a player's name.
 *
 * ⚠ HYPHEN AND APOSTROPHE ARE NOT BOUNDARIES. They are name characters here:
 * treating them as separators matches "Ross" inside "Ross-Smithson" and "Amon"
 * inside "Amon-Ra", which puts the wrong face beside a recommendation — the one
 * outcome these cards must never produce. A hyphenated name still matches in
 * full, because the pattern is the whole name.
 */
function answerMentions(answer: string, name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length < 3) return false
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}'\\u2019-])${escaped}([^\\p{L}\\p{N}'\\u2019-]|$)`, 'iu').test(answer)
}

/**
 * Cards for the players named in `answer`, drawn from the rosters Chimmy was
 * grounded on. Returns an empty array when nothing matches, so the caller can
 * omit the field rather than send an empty section.
 */
export function buildChimmyPlayerCards(args: {
  answer: string
  rosters: LeagueGroundingRoster[] | null | undefined
  sport: SupportedSport
}): ChimmyPlayerCard[] {
  const { answer, rosters, sport } = args
  if (!answer?.trim() || !rosters?.length) return []

  const cards: ChimmyPlayerCard[] = []
  const seen = new Set<string>()

  for (const roster of rosters) {
    const entries = [
      ...(roster.starters ?? []).map((p) => ({ p, isStarter: true })),
      ...(roster.bench ?? []).map((p) => ({ p, isStarter: false })),
    ]
    for (const { p, isStarter } of entries) {
      if (cards.length >= MAX_CARDS) return cards
      if (!p?.playerName || seen.has(p.playerId)) continue
      if (!answerMentions(answer, p.playerName)) continue
      seen.add(p.playerId)
      cards.push({
        playerId: p.playerId,
        name: p.playerName,
        position: p.position ?? null,
        team: p.team ?? null,
        imageUrl: looksLikeSleeperExternalId(p.playerId)
          ? sleeperHeadshotUrl(p.playerId, sport.toLowerCase() as never)
          : null,
        isStarter,
      })
    }
  }

  return cards
}

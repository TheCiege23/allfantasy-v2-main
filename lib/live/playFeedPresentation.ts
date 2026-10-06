import { prisma } from '@/lib/prisma'
import { readPlayByPlayFeed } from '@/lib/live/playByPlayFeed'
import type { LiveEvent } from '@/lib/live/eventDetector'
/*
 * Imported from the registry DIRECTLY rather than through
 * `draft-sports-models/player-asset-resolver`, whose `resolveTeamLogoUrlSync`
 * wraps this same call but also pulls `lib/player-media` in with it. The
 * registry is pure — no fetch anywhere in it — so this adds a lookup table, not
 * a dependency on anything that talks to a provider.
 */
import { getPrimaryLogoUrlForTeam } from '@/lib/sport-teams/SportTeamMetadataRegistry'

/**
 * Turn the raw play feed into something renderable.
 *
 * ⚠ THIS IS THE HALF THAT WAS MISSING. `refreshPlayByPlayFeed` has been polling
 * Rolling Insights, parsing plays and storing events since the live tick was
 * wired — but `readPlayByPlayFeed` had ZERO callers, so every play we paid to
 * fetch went straight into a cache nothing rendered. Ingestion without a reader
 * looks identical to a broken feed from the outside.
 *
 * Three things the raw `LiveEvent` cannot answer on its own:
 *   - a headshot: the event carries the Rolling Insights player id, not ours
 *   - a readable sentence: it carries `stat` + `delta`, not "34-yard rushing TD"
 *   - a team: `teamAbbr` is null on every play RI has ever sent us, so the
 *     badge comes from our identity map rather than from the feed
 */

export type PlayFeedItem = {
  /** Slate ID resolved from provider fixture evidence, never compared across vendors raw. */
  canonicalGameId?: string | null
  id: string
  gameId: string
  type: LiveEvent['type']
  playerName: string
  /**
   * The player's Sleeper id, from the identity map. Two jobs: a headshot from
   * Sleeper's CDN for the ~85% of players with no `imageUrl` on file (the row
   * otherwise draws a letter), and the id the player card opens with. Null when
   * the Rolling Insights id does not resolve — no guessed id, same rule as the
   * headshot below.
   */
  sleeperId: string | null
  /**
   * ⚠ ROLLING INSIGHTS NEVER SENDS THIS, so it is backfilled from our own
   * identity map. Measured 2026-08-27: every one of the 12 events cached in
   * prod had `team: null`. That is not a parser bug — `PLAY-BY-PLAY.yaml`
   * declares `teamAbbr` as `[string, "null"]` with no example, and the parser
   * passes through faithfully. The team has to come from somewhere else.
   */
  team: string | null
  /**
   * ESPN CDN badge for `team`, or null when the team is unknown. Never a
   * guessed URL: the registry builds a URL for ANY string handed to it, so a
   * wrong abbreviation yields a confident 404 rather than an empty slot.
   */
  teamLogoUrl: string | null
  /** Null for the ~85% of players with no headshot on file. Render initials. */
  imageUrl: string | null
  position: string | null
  /** Pre-composed for display, e.g. "Ashton Jeanty (RB) 34-yard rushing TD". */
  headline: string
  /**
   * The headline without the player: "34-yard receiving TD from Kirk Cousins".
   * The row renders the name itself as a player-card button, then this.
   */
  action: string
  /**
   * What `action` was built from (2026-10-04), so a surface can say it in Spanish
   * (lib/core-app/homeBandsCopy.ts `playActionText`). `action` and `headline` are unchanged.
   */
  actionParts?: PlayActionParts
  /** Yards on THIS play, or null when the event carries no play yardage. */
  yards: number | null
  detectedAt: string
}

/**
 * ⚠ THE FEED CARRIES ROLLING INSIGHTS IDS, NOT OURS. The join is
 * `PlayerIdentityMap.rollingInsightsId` — 1,933 rows, all populated — and never
 * on name. `player-and-roster-id-join-hazards` is explicit that a name is not a
 * safe key here: most same-name groups in this database are genuinely different
 * people, so a name join would confidently attach the wrong face to a highlight.
 *
 * When the id does not resolve we return the event WITHOUT an image rather than
 * guessing. A missing headshot is a cosmetic gap; the wrong headshot on a
 * touchdown alert is a visible, embarrassing error.
 */
type Resolved = { imageUrl: string | null; position: string | null; team: string | null; sleeperId: string | null }

async function resolveHeadshots(riPlayerIds: string[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>()
  // `name:<x>` is the parser's fallback when a play carries no player id at all.
  const ids = [...new Set(riPlayerIds.filter((id) => id && !id.startsWith('name:')))]
  if (ids.length === 0) return out

  try {
    const identities = await prisma.playerIdentityMap.findMany({
      where: { rollingInsightsId: { in: ids } },
      /*
       * `currentTeam` rides along on a query we were already making, so the
       * team costs no extra round trip. It is also the RIGHT source rather
       * than merely the cheap one: measured on prod, all 1,933 NFL identity
       * rows carry BOTH `rollingInsightsId` and `currentTeam`, while the
       * `Player` join below is lossy — D'Ernest Johnson resolves to a Player
       * row whose `team` is null but whose identity row says "NE".
       *
       * `sleeperId` rides along for the same reason: the identity row is the
       * crosswalk, and the Sleeper id is what the headshot fallback and the
       * player card both key on.
       */
      select: {
        rollingInsightsId: true,
        canonicalName: true,
        position: true,
        sport: true,
        currentTeam: true,
        sleeperId: true,
      },
    })
    if (identities.length === 0) return out

    /*
     * The identity map holds the crosswalk but not the image, so the headshot
     * comes from `Player`. Matched on normalised name WITHIN the sport, because
     * the identity map has no foreign key to Player — and scoped by sport
     * because `externalId` and names are only unique within one.
     */
    const names = identities.map((i) => i.canonicalName).filter(Boolean)
    const players = await prisma.player.findMany({
      where: { name: { in: names }, sport: 'NFL', imageUrl: { not: null } },
      select: { name: true, imageUrl: true, position: true },
    })
    const byName = new Map(players.map((p) => [p.name.toLowerCase(), p]))

    for (const identity of identities) {
      if (!identity.rollingInsightsId) continue
      const hit = byName.get((identity.canonicalName ?? '').toLowerCase())
      out.set(identity.rollingInsightsId, {
        imageUrl: hit?.imageUrl ?? null,
        position: identity.position ?? hit?.position ?? null,
        team: identity.currentTeam ?? null,
        sleeperId: identity.sleeperId ?? null,
      })
    }
  } catch {
    // A headshot lookup must never break the feed. Plays without faces still
    // beat no plays.
    return out
  }
  return out
}

/** Rolling Insights' `event` enum — the value `stat` carries on a play-by-play event. */
const PBP_EVENTS = new Set([
  'kickoff', 'pass', 'run', 'sack', 'interception', 'incompletion',
  'fumble', 'penalty', 'field_goal', 'punt', 'safety', 'not_available',
])

/**
 * The yards gained on THIS play, or null when the event does not carry them.
 *
 * Two sources, two meanings, and reading the wrong field is how a headline lies:
 *   - play-by-play: `delta` IS the play's `yardsGained`;
 *   - the box-score detector's `*_long` stats: the play's yards are the NEW long
 *     (`value`), and `delta` is only how far the long moved;
 *   - a touchdown COUNTER (`rushing_touchdowns`) has a delta of 1, not yards.
 */
export function playYards(event: LiveEvent): number | null {
  const n = /_long$/.test(event.stat)
    ? event.value
    : PBP_EVENTS.has(event.stat) || /_yards$/.test(event.stat)
      ? event.delta
      : null
  return n != null && Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

function unitOf(event: LiveEvent): 'rushing' | 'receiving' | 'passing' | null {
  const role = event.role ?? null
  const s = event.stat
  if (role === 'passer' || s.startsWith('passing')) return 'passing'
  if (role === 'receiver' || role === 'lateral_receiver' || s.startsWith('receiving')) return 'receiving'
  if (role === 'rusher' || s.startsWith('rushing')) return 'rushing'
  if (s === 'run') return 'rushing'
  if (s === 'pass') return 'receiving'
  return null
}

/**
 * Which play it was, and the values its sentence names — one kind per sentence
 * `playActionFor` can write (2026-10-04). A Spanish surface rebuilds its own
 * sentence from the same parts (lib/core-app/homeBandsCopy.ts `playActionText`),
 * so the two can never disagree about which play happened.
 */
export type PlayActionParts = {
  kind:
    | 'rushing-td' | 'receiving-td' | 'passing-td' | 'touchdown'
    | 'run' | 'catch' | 'completion' | 'gain'
    | 'field-goal'
    | 'intercepted' | 'recovered' | 'threw-int' | 'lost-fumble' | 'turnover'
    | 'pick-six' | 'fumble-return-td' | 'safety' | 'defensive-td'
    | 'kickoff-return-td' | 'punt-return-td' | 'special-teams-td'
  yards: number | null
  /** The passer, on a play told from the receiver's side. */
  from: string | null
  /** The receiver, on a play told from the passer's side. */
  to: string | null
}

export function playActionParts(event: LiveEvent): PlayActionParts | null {
  const unit = unitOf(event)
  const kind = ((): PlayActionParts['kind'] | null => {
    switch (event.type) {
      case 'TOUCHDOWN':
        return unit === 'rushing' ? 'rushing-td' : unit === 'receiving' ? 'receiving-td' : unit === 'passing' ? 'passing-td' : 'touchdown'
      case 'BIG_PLAY':
        return unit === 'rushing' ? 'run' : unit === 'receiving' ? 'catch' : unit === 'passing' ? 'completion' : 'gain'
      case 'FIELD_GOAL':
        return 'field-goal'
      case 'TURNOVER':
        if (event.role === 'interceptor') return 'intercepted'
        if (event.role === 'recoverer') return 'recovered'
        if (event.stat === 'passing_interceptions') return 'threw-int'
        if (event.stat === 'fumbles_lost') return 'lost-fumble'
        return 'turnover'
      case 'DEFENSIVE_SCORE':
        if (event.stat === 'interception' || event.stat === 'interception_touchdowns') return 'pick-six'
        if (event.stat === 'fumble' || event.stat === 'fumble_return_touchdowns') return 'fumble-return-td'
        if (event.stat === 'safety') return 'safety'
        return 'defensive-td'
      case 'SPECIAL_TEAMS_SCORE':
        if (event.stat === 'kickoff' || event.stat === 'kick_return_touchdowns') return 'kickoff-return-td'
        if (event.stat === 'punt' || event.stat === 'punt_return_touchdowns') return 'punt-return-td'
        return 'special-teams-td'
      default:
        return null
    }
  })()
  if (!kind) return null
  return { kind, yards: playYards(event), from: event.passerName || null, to: event.receiverName || null }
}

/**
 * What the player did, without his name: "34-yard rushing TD",
 * "34-yard receiving TD from Kirk Cousins", "33-yard catch from Kyler Murray".
 *
 * Built from structured fields rather than the vendor's `description`, which is
 * prose we do not control and names teams in a format that does not match ours.
 */
export function playActionFor(event: LiveEvent): string {
  const p = playActionParts(event)
  if (!p) return ''
  const y = p.yards
  const yd = y != null ? `${y}-yard ` : ''
  const from = p.from ? ` from ${p.from}` : ''
  const to = p.to ? ` to ${p.to}` : ''

  switch (p.kind) {
    case 'rushing-td':
      return `${yd}rushing TD`
    case 'receiving-td':
      return `${yd}receiving TD${from}`
    case 'passing-td':
      return `${yd}TD pass${to}`
    case 'touchdown':
      return 'scored a touchdown'
    case 'run':
      return y != null ? `${y}-yard run` : 'long run'
    case 'catch':
      return y != null ? `${y}-yard catch${from}` : `long catch${from}`
    case 'completion':
      return y != null ? `${y}-yard completion${to}` : `long completion${to}`
    case 'gain':
      return y != null ? `${y}-yard gain` : 'big gain'
    case 'field-goal':
      return 'made a field goal'
    case 'intercepted':
      return 'intercepted a pass'
    case 'recovered':
      return 'recovered a fumble'
    case 'threw-int':
      return 'threw an interception'
    case 'lost-fumble':
      return 'lost a fumble'
    case 'turnover':
      return 'turned it over'
    case 'pick-six':
      return 'pick-six'
    case 'fumble-return-td':
      return 'fumble return TD'
    case 'safety':
      return 'safety'
    case 'defensive-td':
      return 'defensive TD'
    case 'kickoff-return-td':
      return 'kickoff return TD'
    case 'punt-return-td':
      return 'punt return TD'
    case 'special-teams-td':
      return 'special teams TD'
  }
}

/** The sentence a user actually reads, e.g. "Ashton Jeanty (RB) 34-yard rushing TD". */
export function headlineFor(event: LiveEvent, position: string | null): string {
  const who = position ? `${event.playerName} (${position})` : event.playerName
  const action = playActionFor(event)
  return action ? `${who} ${action}` : who
}

/**
 * The renderable feed. Returns [] on a quiet day — an empty feed is the correct
 * answer on a Tuesday, not an error.
 */
export async function getPlayFeed(limit = 12): Promise<PlayFeedItem[]> {
  let events: LiveEvent[] = []
  try {
    events = await readPlayByPlayFeed(limit)
  } catch {
    return []
  }
  if (events.length === 0) return []

  const headshots = await resolveHeadshots(events.map((e) => e.playerId))

  return events.map((event) => {
    const extra = headshots.get(event.playerId)
    const position = extra?.position ?? null
    /*
     * ⚠ THE PLAY'S OWN TEAM WINS, and the order is not arbitrary. `event.team`
     * is the team the player was on FOR THIS PLAY; `currentTeam` is where the
     * identity map thinks he is today. They diverge the moment someone is
     * traded, and for a play that already happened the play is the truth. So
     * the identity map is strictly a fallback for the null RI always sends —
     * if RI ever starts populating `teamAbbr`, this needs no change.
     */
    const team = event.team ?? extra?.team ?? null
    return {
      // The parser's idempotency key is already game+sequence+type, so it is a
      // stable React key and survives the same play being re-read each poll.
      id: event.idempotencyKey,
      gameId: event.gameId,
      type: event.type,
      playerName: event.playerName,
      sleeperId: extra?.sleeperId ?? null,
      team,
      // Only ever derived from a team we actually resolved — see the field doc.
      teamLogoUrl: team ? getPrimaryLogoUrlForTeam('NFL', team) : null,
      imageUrl: extra?.imageUrl ?? null,
      position,
      headline: headlineFor(event, position),
      action: playActionFor(event),
      actionParts: playActionParts(event) ?? undefined,
      yards: playYards(event),
      detectedAt:
        event.detectedAt instanceof Date
          ? event.detectedAt.toISOString()
          : new Date(event.detectedAt).toISOString(),
    }
  })
}

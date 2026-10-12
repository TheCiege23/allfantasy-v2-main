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
import { headshotUrl } from '@/lib/media-url'
import { normalizePlayerName, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { displayPlayName, isShortFormName } from '@/lib/player-match/displayNameCasing'

/**
 * The sport every play in this feed belongs to. Not a guess: `refreshPlayByPlayFeed` polls only
 * `sport: 'NFL'` Rolling Insights games, asks `/play-by-play/NFL`, and writes `pbp:feed:NFL`.
 * `LiveEvent` carries no sport of its own, so every identity lookup keyed on a play's player id
 * must be scoped with THIS — see `resolveHeadshots` for what happens when it is not.
 */
export const PLAY_FEED_SPORT = 'NFL'

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
 * (`PlayerIdentityMap.sport`, `rollingInsightsId`) — the id alone is NOT a key,
 * see the query below — and never on name. `player-and-roster-id-join-hazards` is explicit that a name is not a
 * safe key here: most same-name groups in this database are genuinely different
 * people, so a name join would confidently attach the wrong face to a highlight.
 *
 * When the id does not resolve we return the event WITHOUT an image rather than
 * guessing. A missing headshot is a cosmetic gap; the wrong headshot on a
 * touchdown alert is a visible, embarrassing error.
 */
type Resolved = {
  imageUrl: string | null
  position: string | null
  team: string | null
  sleeperId: string | null
  /** The identity row's canonical name — what a shortened vendor name ("A.St") is shown as. */
  name: string | null
}

/** The Sleeper id a `Player` row carries in `providerIds.sleeper` ("sleeper:4984" / "sleeper_13524"), or null. */
function sleeperIdOfPlayer(providerIds: unknown): string | null {
  if (!providerIds || typeof providerIds !== 'object' || Array.isArray(providerIds)) return null
  const raw = (providerIds as Record<string, unknown>).sleeper
  if (typeof raw !== 'string') return null
  // Team-defense rows carry "sleeper_KC" — not a player id, so not a match key.
  const m = /^(?:sleeper[:_])?(\d+)$/.exec(raw.trim())
  return m ? m[1]! : null
}

type HeadshotCandidate = {
  name: string
  imageUrl: string | null
  position: string | null
  team: string | null
  sleeperId: string | null
}

/** The identity fields every lookup below selects. */
const IDENTITY_SELECT = {
  rollingInsightsId: true,
  canonicalName: true,
  position: true,
  sport: true,
  currentTeam: true,
  sleeperId: true,
} as const

async function resolveHeadshots(
  events: ReadonlyArray<{ playerId: string; playerName: string }>,
): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>()
  // `name:<x>` is the parser's fallback when a play carries no player id at all.
  const ids = [...new Set(events.map((e) => e.playerId).filter((id) => id && !id.startsWith('name:')))]
  /*
   * 🛑 PLAYS WITH NO VENDOR ID, AND SINCE 2026-10-11 ~22:25Z THAT IS NEARLY ALL OF THEM. A read-only
   * probe of the cached feed found 19 of 20 plays carrying the parser's `name:` fallback (no
   * `players[].id`, and no `teamAbbr` either) — so every play on /core/live rendered unresolved:
   * no face, position, club or Sleeper id. Recorded as a contract gap (GAPS.md N-18).
   *
   * Those plays are matched by FULL NAME against NFL identities, and only when exactly ONE NFL
   * identity carries that name — two namesakes, a short form ("A.St"), or a single-word name resolve
   * to nothing. Looked up on the indexed `normalizedName` column and RE-CHECKED with this module's
   * own normaliser, so a column normalised differently can only miss, never mis-match.
   *
   * 🛑 AND IT DID MISS, ON A THIRD OF THE NAMES WITH PUNCTUATION. The column is written by
   * `normalizePlayerName` (lib/team-abbrev.ts), which KEEPS hyphens and apostrophes — "jaxon
   * smith-njigba", "tre'davious white" — while `normalizeMatchName` strips them. Measured on prod
   * 2026-10-12: 367 of 692 NFL identities with `-`, `'` or `.` in the name (184 / 190 / 7) could
   * never be found by our key, Jaxon Smith-Njigba among them. So the lookup asks for the WRITER'S key
   * as well as ours, and the identity check on what comes back is unchanged. (The first look at
   * this reported "0 divergent of 11" — it inspected only rows our key had already found, so a row
   * that disagreed could never be in the sample.)
   */
  const lookupKeys = new Set<string>() // what to ask the column for: the writer's key and ours
  const byNameKey = new Map<string, string[]>() // normalised name -> the `name:` player ids carrying it
  for (const e of events) {
    if (!e.playerId?.startsWith('name:')) continue
    const name = e.playerName?.trim() ?? ''
    if (!name || isShortFormName(name) || name.split(/\s+/).length < 2) continue
    const key = normalizeMatchName(name)
    if (!key) continue
    byNameKey.set(key, [...(byNameKey.get(key) ?? []), e.playerId])
    lookupKeys.add(key)
    const written = normalizePlayerName(name)
    if (written) lookupKeys.add(written)
  }
  if (ids.length === 0 && byNameKey.size === 0) return out

  try {
    /*
     * 🛑 SCOPED TO THE FEED'S SPORT, BECAUSE A ROLLING INSIGHTS ID IS ONLY UNIQUE WITHIN ONE.
     * RI numbers players per sport, and the identity map holds every sport it ingests. Measured on
     * production 2026-10-11: all 9,567 NFL RI ids are ALSO the RI id of some MLB / NBA / NHL /
     * NCAAB / NCAAF / soccer identity row. RI 3036 is Patrick Mahomes in NFL and John Stephens Jr.
     * (WR, Texas Christian University) in NCAAF, among four others; unscoped, the rows came back
     * in arbitrary order, the LAST one won, and the Game Day band printed "Patrick Mahomes (WR)"
     * with a TCU badge and no face. The schema's `@@unique([sport, rollingInsightsId])` makes
     * (sport, id) the key — never the id alone.
     */
    const identities = ids.length === 0 ? [] : await prisma.playerIdentityMap.findMany({
      where: { sport: PLAY_FEED_SPORT, rollingInsightsId: { in: ids } },
      /*
       * `currentTeam` rides along on a query we were already making, so the
       * team costs no extra round trip. It is also the RIGHT source rather
       * than merely the cheap one: measured on prod, all NFL identity
       * rows carry BOTH `rollingInsightsId` and `currentTeam`, while the
       * `Player` join below is lossy — D'Ernest Johnson resolves to a Player
       * row whose `team` is null but whose identity row says "NE".
       *
       * `sleeperId` rides along for the same reason: the identity row is the
       * crosswalk, and the Sleeper id is what the headshot fallback and the
       * player card both key on.
       */
      select: IDENTITY_SELECT,
    })

    // Belt and braces for the `where` above: a row from another sport, or two rows for one id
    // (the unique constraint forbids it, but a refusal costs a face and a guess costs the wrong
    // one), resolves to nothing rather than to whichever came last.
    const rowsByRiId = new Map<string, typeof identities>()
    for (const identity of identities) {
      if (!identity.rollingInsightsId) continue
      if ((identity.sport ?? '').toUpperCase() !== PLAY_FEED_SPORT) continue
      const list = rowsByRiId.get(identity.rollingInsightsId) ?? []
      list.push(identity)
      rowsByRiId.set(identity.rollingInsightsId, list)
    }
    const resolved = [...rowsByRiId.values()]
      .filter((rows) => rows.length === 1)
      .map((rows) => ({ key: rows[0]!.rollingInsightsId!, identity: rows[0]! }))

    if (byNameKey.size > 0) {
      const named = await prisma.playerIdentityMap
        .findMany({ where: { sport: PLAY_FEED_SPORT, normalizedName: { in: [...lookupKeys] } }, select: IDENTITY_SELECT })
        .catch((err: unknown) => {
          console.error('[play-feed] name fallback read failed:', err instanceof Error ? err.message : err)
          return []
        })
      const rowsByName = new Map<string, typeof named>()
      for (const row of named) {
        if ((row.sport ?? '').toUpperCase() !== PLAY_FEED_SPORT) continue
        const key = normalizeMatchName(row.canonicalName)
        if (!byNameKey.has(key)) continue
        rowsByName.set(key, [...(rowsByName.get(key) ?? []), row])
      }
      for (const [key, rows] of rowsByName) {
        if (rows.length !== 1) continue // namesakes: refuse rather than pick one
        for (const playerId of new Set(byNameKey.get(key))) resolved.push({ key: playerId, identity: rows[0]! })
      }
    }
    if (resolved.length === 0) return out

    /*
     * The identity map holds the crosswalk but not the image, so a stored headshot comes from
     * `Player`, which has no foreign key to the identity map.
     *
     * 🛑 NEVER A NAME → ROW MAP. This used to be `new Map(players.map(p => [name, p]))`, which
     * keeps the LAST row per name. Measured on production 2026-10-11: 1,009 NFL names have more
     * than one `Player` row with an image, 895 of them with DIFFERENT images — so WR Justin
     * Jefferson (MIN) could wear LB Justin Jefferson's (CLE) face, and QB Josh Allen a guard's.
     * The bind now goes, strongest first:
     *   1. the namesake `Player` row whose Sleeper provider id IS the identity row's Sleeper id;
     *   2. a name match VERIFIED on position / team (`resolveVerifiedMatch`), refused when
     *      ambiguous, when the lone namesake contradicts, or when its own Sleeper id names
     *      somebody else;
     *   3. Sleeper's CDN by the identity row's Sleeper id — an id-keyed join, so it cannot pick
     *      the wrong person; a CDN miss falls back to initials in the row.
     */
    const names = [...new Set(resolved.map(({ identity: i }) => i.canonicalName).filter(Boolean))]
    /*
     * 🛑 ITS OWN FAILURE, NOT THE IDENTITY READ'S. This query sat inside the one `try` whose `catch`
     * returned an empty map, so any error here — a column the production table lacks, a timeout —
     * erased the position, club, Sleeper id and name the identity rows had ALREADY resolved, and every
     * play rendered as a bare name with initials. Seen on prod 2026-10-11, with nothing logged. A
     * failure now costs only the stored headshot (the Sleeper CDN fallback below still applies), and
     * it says so in the logs.
     */
    const players = names.length
      ? await prisma.player
          .findMany({
            where: { name: { in: names }, sport: PLAY_FEED_SPORT, imageUrl: { not: null } },
            select: { name: true, imageUrl: true, position: true, team: true, providerIds: true },
          })
          .catch((err: unknown) => {
            console.error('[play-feed] Player headshot read failed; identities kept:', err instanceof Error ? err.message : err)
            return []
          })
      : []
    const index = buildNameIndex<HeadshotCandidate>(
      players.map((p) => ({
        name: p.name,
        imageUrl: p.imageUrl ?? null,
        position: p.position ?? null,
        team: normalizeTeamAbbrev(p.team) ?? p.team ?? null,
        sleeperId: sleeperIdOfPlayer(p.providerIds),
      })),
    )

    for (const { key, identity } of resolved) {
      const sleeperId = identity.sleeperId ?? null
      const namesakes = index.get(normalizeMatchName(identity.canonicalName)) ?? []
      const byId = sleeperId ? namesakes.filter((c) => c.sleeperId === sleeperId) : []
      let hit: HeadshotCandidate | null = byId.length === 1 ? byId[0]! : null
      if (!hit) {
        const verified = resolveVerifiedMatch(
          index,
          {
            name: identity.canonicalName ?? '',
            position: identity.position,
            team: normalizeTeamAbbrev(identity.currentTeam) ?? identity.currentTeam,
          },
          // The index holds only rows WITH an image, so a lone namesake is not proof of identity.
          { refuseContradictedSingle: true },
        ).match
        // A verified namesake whose own Sleeper id names a different player IS a different player.
        hit = verified && !(verified.sleeperId && sleeperId && verified.sleeperId !== sleeperId) ? verified : null
      }

      out.set(key, {
        imageUrl: hit?.imageUrl ?? (sleeperId ? headshotUrl(sleeperId) || null : null),
        position: identity.position ?? hit?.position ?? null,
        team: identity.currentTeam ?? null,
        sleeperId,
        name: identity.canonicalName ?? null,
      })
    }
  } catch (err) {
    // A headshot lookup must never break the feed. Plays without faces still
    // beat no plays — but a lookup that resolves nobody must be visible somewhere.
    console.error('[play-feed] identity read failed; plays render unresolved:', err instanceof Error ? err.message : err)
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

  const headshots = await resolveHeadshots(events)

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
    /* "A.St" → "Amon-Ra St. Brown" when the play's own id resolved; casing repaired either way. */
    const name = displayPlayName(event.playerName, extra?.name)
    return {
      // The parser's idempotency key is already game+sequence+type, so it is a
      // stable React key and survives the same play being re-read each poll.
      id: event.idempotencyKey,
      gameId: event.gameId,
      type: event.type,
      playerName: name,
      sleeperId: extra?.sleeperId ?? null,
      team,
      // Only ever derived from a team we actually resolved — see the field doc.
      teamLogoUrl: team ? getPrimaryLogoUrlForTeam(PLAY_FEED_SPORT, team) : null,
      imageUrl: extra?.imageUrl ?? null,
      position,
      headline: headlineFor({ ...event, playerName: name }, position),
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

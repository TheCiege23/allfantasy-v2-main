import { toImageUrl } from '@/lib/media/imageUrl'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import {
  indexBySleeperId,
  mayBeSleeperId,
  nonSleeperExternalIdWhere,
  sleeperIdWhere,
} from '@/lib/player-identity/externalIdNamespace'
import { isSleeperDefenseId, matchTeam } from '@/lib/draft/sleeperNameCandidates'
import { sleeperHeadshotUrl } from '@/lib/player-media-urls'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type NewsItem = {
  id: string
  title: string
  content: string | null
  source: string
  sourceUrl: string | null
  publishedAt: string | null
  category: string | null
}

type InjuryItem = {
  status: string | null
  type: string | null
  description: string | null
  date: string | null
  source: string
  /** True when the designation is past the port's 36h claim-freshness rule —
   *  render caveated, never plainly (a stale "Questionable" is a false statement). */
  stale: boolean
}

type SeedRow = {
  name: string
  position: string | null
  team: string | null
  height: string | null
  weight: string | null
  age: number | null
  college: string | null
  imageUrl: string | null
  status: string | null
  source: string
  sleeperId: string | null
}

/** Who an id names, read from the namespace the id is written in. Every other read is checked against it. */
type Anchor = {
  name: string
  position: string | null
  /** Abbreviation, or null for a free agent / unknown. */
  team: string | null
  seed: SeedRow | null
  source: string
}

/**
 * GET /api/draft/player-detail?sport=NFL&playerId=4984
 *
 * Aggregates everything the player-click modal in the draft room needs:
 *   - core profile from SportsPlayer / SportsPlayerRecord (DB cache populated
 *     by the unified provider chain — RI → TSDB → API-Sports → ClearSports → Sleeper → ESPN)
 *   - current injury designation via the canonical injury read port
 *   - latest news from SportsNews (also written by the chain)
 *   - season stats + projections (already on SportsPlayerRecord)
 *
 * No external network calls — everything comes from the DB cache that the
 * importers + chain populate. The fall-back to "Player ${id}" is intentional
 * so the modal can still render even if the lookup misses.
 *
 * 🛑 THE ID IS READ IN ITS OWN NAMESPACE, AND EVERYTHING ELSE MUST AGREE WITH WHO IT NAMES (2026-10-11).
 * The draft board's ids are Sleeper ids (see lib/draft/sleeperDraftBoard.ts). This route used to read
 * `SportsPlayerRecord` `NFL:<id>` for any id and fall back to `SportsPlayer` with
 * `externalId = id OR sleeperId = id` — so the board's old `2135` (a backfill Josh Allen row) opened
 * Ha Ha Clinton-Dix, who is Sleeper 2135, and the fallback could land on Josh Hines-Allen, who is
 * Rolling Insights 2135. Measured on production: 5,895 Rolling Insights and 190 backfill rows carry a
 * numeric externalId that is a DIFFERENT person's `SportsPlayerRecord` id.
 *
 * Now: an NFL bare number is a Sleeper id and is asked only of `sleeperId` (`sleeperIdWhere`); any
 * other id only of non-Sleeper `externalId`. The person found there is the ANCHOR, and a
 * `SportsPlayerRecord` is used only when its name and side of the ball agree with it. News is matched
 * on name AND team, never on name alone.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const playerIdRaw = (sp.get('playerId') || '').trim()
  if (!playerIdRaw) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 })
  }
  const sport = normalizeToSupportedSport(sp.get('sport') || playerIdRaw.split(':')[0] || 'NFL')

  // Our own spellings of one id: `NFL:4984`, `sleeper:4984`, `NFL:sleeper:4984` all mean Sleeper 4984.
  let id = playerIdRaw
  if (id.toUpperCase().startsWith(`${sport}:`)) id = id.slice(sport.length + 1)
  const sleeperPrefixed = /^sleeper:/i.test(id)
  if (sleeperPrefixed) id = id.slice('sleeper:'.length)
  const isSleeperId = mayBeSleeperId(id, sport)
  // A team defense on the board carries Sleeper's DEF id — the team abbreviation (`BUF`).
  const isDefenseId = !isSleeperId && isSleeperDefenseId(id, sport)
  const inSleeperSpace = isSleeperId || isDefenseId

  const seedSelect = {
    name: true,
    position: true,
    team: true,
    height: true,
    weight: true,
    age: true,
    college: true,
    imageUrl: true,
    status: true,
    source: true,
    sleeperId: true,
  } as const

  let anchor: Anchor | null = null
  if (inSleeperSpace) {
    const rows = (await prisma.sportsPlayer
      .findMany({ where: sleeperIdWhere([id], sport), select: seedSelect, orderBy: { fetchedAt: 'desc' } })
      .catch(() => [])) as SeedRow[]
    const seed = indexBySleeperId(rows).get(id) ?? null
    if (seed) {
      anchor = { name: seed.name, position: seed.position, team: matchTeam(seed.team), seed, source: seed.source }
    } else {
      const ident = await prisma.playerIdentityMap
        .findFirst({
          where: { sport, sleeperId: id },
          select: { canonicalName: true, position: true, currentTeam: true },
        })
        .catch(() => null)
      if (ident) {
        anchor = {
          name: ident.canonicalName,
          position: ident.position,
          team: matchTeam(ident.currentTeam),
          seed: null,
          source: 'identity_map',
        }
      }
    }
  } else if (!sleeperPrefixed) {
    const rows = (await prisma.sportsPlayer
      .findMany({ where: nonSleeperExternalIdWhere([id], sport), select: seedSelect, orderBy: { fetchedAt: 'desc' } })
      .catch(() => [])) as SeedRow[]
    // Several providers can use one token for different people; bind only when they all name one person.
    const names = new Set(rows.map((r) => normalizeMatchName(r.name)))
    const seed = names.size === 1 ? rows[0]! : null
    if (seed) anchor = { name: seed.name, position: seed.position, team: matchTeam(seed.team), seed, source: seed.source }
  }

  // SportsPlayerRecord (richer: stats / projections / headshot) — only when it is the anchor's person.
  const recordIds = inSleeperSpace ? [`${sport}:sleeper:${id}`, `${sport}:${id}`] : sleeperPrefixed ? [] : [`${sport}:${id}`]
  const recordRows = anchor && recordIds.length
    ? await prisma.sportsPlayerRecord.findMany({ where: { id: { in: recordIds } } }).catch(() => [])
    : []
  const record =
    recordIds
      .map((rid) => recordRows.find((r) => r.id === rid))
      .find(
        (r) =>
          r != null &&
          anchor != null &&
          resolveVerifiedMatch(
            buildNameIndex([r]),
            { name: anchor.name, position: anchor.position, team: null },
            { refuseContradictedSingle: true },
          ).match != null,
      ) ?? null

  const seed = anchor?.seed ?? null
  const playerName = anchor?.name ?? null
  const position = anchor?.position ?? record?.position ?? null
  const team = anchor?.team ?? matchTeam(record?.team) ?? null

  /*
   * Last 6 news items for this player. `SportsNews.playerId` is never written (0 of ~14,600 NFL
   * rows on 2026-10-11) and its namespace is unknown, so it is not matched. A name alone is not a
   * person — two Josh Allens, two Justin Jeffersons — so the team must agree too, and a player with
   * no known team gets no news rather than a namesake's.
   */
  const newsRows =
    playerName && team
      ? await prisma.sportsNews
          .findMany({
            where: {
              sport,
              playerName: { equals: playerName, mode: 'insensitive' },
              OR: [{ team }, { teams: { has: team } }],
            },
            orderBy: [{ publishedAt: 'desc' }, { fetchedAt: 'desc' }],
            take: 6,
          })
          .catch(() => [])
      : []

  const news: NewsItem[] = newsRows.map((n) => ({
    id: n.id,
    title: n.title,
    content: n.content,
    source: n.source,
    sourceUrl: n.sourceUrl,
    publishedAt: n.publishedAt ? n.publishedAt.toISOString() : null,
    category: n.category,
  }))

  // Slice 18 follow-on — current designation via the canonical injury read
  // port (position/team-verified name match, ambiguity REFUSED rather than
  // guessed). The old query ordered by `date desc`, which let a stale
  // api_sports row outrank a fresh rolling_insights one; the port's
  // freshest-source-wins rule is the fix. One canonical current row replaces
  // the previous list of provider duplicates.
  const injuryResolution = playerName
    ? await resolveInjuryFacts({
        sport,
        players: [{ name: playerName, position, team }],
      }).catch(() => null)
    : null
  const injuryFact = injuryResolution?.byPlayer.get(normalizeMatchName(playerName)) ?? null

  const injuries: InjuryItem[] = injuryFact
    ? [
        {
          status: typeof injuryFact.status === 'string' ? injuryFact.status : null,
          type: injuryFact.type,
          description: injuryFact.description,
          date: injuryFact.date ? injuryFact.date.toISOString() : null,
          source: injuryFact.source,
          stale: injuryFact.stale,
        },
      ]
    : []

  return NextResponse.json({
    playerId: playerIdRaw,
    sport,
    profile: {
      name: playerName ?? record?.name ?? `Player ${playerIdRaw}`,
      team,
      position,
      height: seed?.height ?? null,
      weight: seed?.weight ?? null,
      age: seed?.age ?? null,
      college: seed?.college ?? null,
      headshotUrl:
        record?.headshotUrl ??
        toImageUrl(seed?.imageUrl) ??
        (isSleeperId && anchor ? sleeperHeadshotUrl(id, sport.toLowerCase()) : null),
      injuryStatus: record?.injuryStatus ?? seed?.status ?? null,
      injuryNotes: record?.injuryNotes ?? null,
      adp: record?.adp ?? null,
      dynastyValue: record?.dynastyValue ?? null,
    },
    stats: record?.stats ?? null,
    projections: record?.projections ?? null,
    news,
    injuries,
    sources: {
      profile: record ? record.dataSource : anchor ? anchor.source : null,
      news: newsRows[0]?.source ?? null,
      injuries: injuryFact?.source ?? null,
    },
  })
}

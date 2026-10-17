import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getAllPlayers } from '@/lib/sleeper-client'
import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { newsRowMatchesPlayer, playerNameVariants } from '@/lib/legacy/playerNewsMatch'

/** The legacy modal's player pool is Sleeper's NFL map (`getAllPlayers`), so its news is NFL news. */
const NEWS_SPORT = 'NFL'
const NEWS_LIMIT = 5
/** Candidate rows read before the per-row player check; the check, not this query, decides. */
const NEWS_CANDIDATE_LIMIT = 40

function sleeperFullName(p: any): string {
  return String(p?.full_name || `${p?.first_name ?? ''} ${p?.last_name ?? ''}`).trim()
}

export const POST = withApiUsage({ endpoint: "/api/legacy/player-profile", tool: "LegacyPlayerProfile" })(async (req: NextRequest) => {
  try {
    const { player_name, player_id, position, team } = await req.json()

    if (!player_name && !player_id) {
      return NextResponse.json({ error: 'Player name or ID required' }, { status: 400 })
    }

    const allPlayers = await getAllPlayers()

    let player: any = null
    let sleeperId = player_id || null

    if (player_id && allPlayers[player_id]) {
      player = allPlayers[player_id]
      sleeperId = player_id
    } else if (player_name) {
      /*
       * 🛑 A NAME IS NOT AN IDENTITY. This used to bind the FIRST Sleeper entry with that exact
       * name — and Sleeper's map holds genuine namesakes (WR DeVonta Smith PHI / CB DeVonta Smith
       * CAR; RB Michael Carter / CB Michael Carter). Bind only when position/team verify the
       * candidate, and refuse an ambiguous or contradicted bind rather than show someone else.
       */
      const key = normalizeMatchName(player_name)
      const candidates: Array<{ id: string; name: string; position: string | null; team: string | null }> = []
      if (key) {
        for (const [pid, p] of Object.entries(allPlayers)) {
          const name = sleeperFullName(p)
          if (normalizeMatchName(name) !== key) continue
          candidates.push({ id: pid, name, position: (p as any).position ?? null, team: (p as any).team ?? null })
        }
      }
      const result = resolveVerifiedMatch(
        buildNameIndex(candidates),
        {
          name: String(player_name),
          position: typeof position === 'string' ? position : null,
          team: typeof team === 'string' ? team : null,
        },
        { refuseContradictedSingle: true },
      )
      if (result.match) {
        player = allPlayers[result.match.id]
        sleeperId = result.match.id
      } else if (result.reason === 'ambiguous') {
        return NextResponse.json(
          { error: 'More than one player has that name; open the player from a roster or search result.' },
          { status: 409 },
        )
      }
    }

    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    const bio = {
      name: player.full_name || `${player.first_name} ${player.last_name}`,
      firstName: player.first_name,
      lastName: player.last_name,
      position: player.position || 'Unknown',
      team: player.team || null,
      age: player.age || null,
      yearsExp: player.years_exp || null,
      college: player.college || null,
      number: player.number || null,
      height: player.height || null,
      weight: player.weight || null,
      status: player.status || null,
      injuryStatus: player.injury_status || null,
      injuryNotes: player.injury_notes || null,
      injuryBodyPart: player.injury_body_part || null,
      depthChartPosition: player.depth_chart_position || null,
      depthChartOrder: player.depth_chart_order || null,
      fantasyPositions: player.fantasy_positions || [],
      searchRank: player.search_rank || null,
      sleeperId,
    }

    let news: any[] = []
    try {
      const { prisma } = await import('@/lib/prisma')
      const variants = playerNameVariants(player)
      if (variants.length > 0) {
        const candidates = await prisma.sportsNews.findMany({
          where: {
            sport: NEWS_SPORT,
            OR: [
              ...variants.map((v) => ({ playerName: { equals: v, mode: 'insensitive' as const } })),
              { playerNames: { hasSome: variants } },
            ],
          },
          orderBy: { publishedAt: 'desc' },
          take: NEWS_CANDIDATE_LIMIT,
          select: {
            id: true,
            title: true,
            content: true,
            source: true,
            publishedAt: true,
            sourceUrl: true,
            playerName: true,
            playerNames: true,
            team: true,
            teams: true,
          },
        })
        news = candidates
          .filter((n) => newsRowMatchesPlayer(n, { name: bio.name, team: bio.team }))
          .slice(0, NEWS_LIMIT)
          .map((n) => ({
            id: n.id,
            title: n.title,
            description: n.content,
            source: n.source,
            publishedAt: n.publishedAt,
            url: n.sourceUrl,
          }))
      }
    } catch (e) {
      console.error('Failed to fetch player news:', e)
    }

    return NextResponse.json({
      ok: true,
      bio,
      news,
    })
  } catch (error: any) {
    console.error('Player profile error:', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch player profile' }, { status: 500 })
  }
})

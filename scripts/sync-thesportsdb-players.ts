/**
 * scripts/sync-thesportsdb-players.ts
 *
 * DB-first ingestion: TheSportsDB â†’ sportsPlayer (source='thesportsdb').
 *
 * TheSportsDB is the PRIMARY source of truth for:
 *   - Player headshot images (strCutout = transparent-background PNG, highest quality)
 *   - Team assignment (strTeam / strTeamShort)
 *   - Position (strPosition)
 *
 * Sleeper is the SECONDARY source â€” fills gaps for players TheSportsDB doesn't have.
 *
 * Strategy (BULK â€” documented API endpoints, not per-player name search):
 *   1. Get all NFL teams: search_all_teams.php?l=NFL (1 call)
 *   2. For each team (32), get full roster: lookup_all_players.php?id={teamId} (32 calls)
 *   3. Upsert all players into sportsPlayer with source='thesportsdb'
 *   Total: ~33 API calls vs ~800 with name-search approach.
 *
 * Rate limits (per docs):
 *   - Free key (123):    30 req/min
 *   - Premium key (ours): 100 req/min
 *
 * Usage:
 *   npx tsx scripts/sync-thesportsdb-players.ts              # dry run
 *   npx tsx scripts/sync-thesportsdb-players.ts --apply      # write to DB
 *   npx tsx scripts/sync-thesportsdb-players.ts --apply --league NBA  # other leagues
 *   npx tsx scripts/sync-thesportsdb-players.ts --apply --team-id 134924  # single team
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient } from '@prisma/client'
import { normalizeTheSportsDbImageUrl } from '../lib/player-assets/imageUrlHygiene'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const prisma = new PrismaClient()

function getTSDBKey(): string {
  return process.env.THESPORTSDB_API_KEY || '123'
}
const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json'

// TheSportsDB league IDs (from docs / known values)
const LEAGUE_IDS: Record<string, string> = {
  NFL: '4391',
  NBA: '4387',
  NHL: '4380',
  MLB: '4424',
  NCAAB: process.env.THESPORTSDB_NCAAM_LEAGUE_ID || '4607',
  NCAAF: process.env.THESPORTSDB_NCAAF_LEAGUE_ID || '4368',
  MLS: process.env.THESPORTSDB_MLS_LEAGUE_ID || '4346',
}

// Delay between calls to stay under 100/min premium rate
const CALL_DELAY_MS = 700

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

interface TSDBTeam {
  idTeam: string
  strTeam: string
  strTeamShort?: string | null
  strLeague?: string | null
}

interface TSDBPlayer {
  idPlayer: string
  strPlayer: string
  strTeam: string | null
  strTeamShort: string | null
  idTeam: string | null
  strPosition: string | null
  strCutout: string | null
  strRender: string | null
  strThumb: string | null
  strFanart1: string | null
  strHeight: string | null
  strWeight: string | null
  strCollege: string | null
  strStatus: string | null
  strNationality: string | null
}

function resolveImage(p: TSDBPlayer): string | null {
  const url = p.strCutout?.trim() || p.strRender?.trim() || p.strThumb?.trim() || p.strFanart1?.trim() || null
  return normalizeTheSportsDbImageUrl(url)
}

// Map full team names â†’ NFL abbreviations
const NFL_TEAM_MAP: Record<string, string> = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAC',
  'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
}

function resolveTeam(p: TSDBPlayer): string | null {
  const short = p.strTeamShort?.trim()
  if (short && !short.startsWith('_')) return short
  const full = p.strTeam?.trim()
  if (!full || full.startsWith('_')) return null
  return NFL_TEAM_MAP[full] || full.toUpperCase().slice(0, 4)
}

async function tsdbFetch<T = unknown>(path: string, params?: Record<string, string>): Promise<T | null> {
  const key = getTSDBKey()
  const url = new URL(`${TSDB_BASE}/${key}/${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v)
    }
  }
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.warn(`  [TSDB] ${path} â†’ HTTP ${res.status}`)
      return null
    }
    return await res.json() as T
  } catch (e) {
    console.warn(`  [TSDB] ${path} â†’ ${e}`)
    return null
  }
}

async function getAllTeams(league: string, leagueId: string): Promise<TSDBTeam[]> {
  // Documented: search_all_teams.php?l={leagueName}
  const data = await tsdbFetch<{ teams?: TSDBTeam[] }>('search_all_teams.php', { l: league })
  if (data?.teams?.length) return data.teams
  // Fallback: lookup by league ID
  const data2 = await tsdbFetch<{ teams?: TSDBTeam[] }>('lookup_all_teams.php', { id: leagueId })
  return data2?.teams || []
}

async function getTeamRoster(teamId: string): Promise<TSDBPlayer[]> {
  // Documented: lookup_all_players.php?id={teamId}
  const data = await tsdbFetch<{ player?: TSDBPlayer[] }>('lookup_all_players.php', { id: teamId })
  return data?.player || []
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const leagueArg = args.find((a) => a.startsWith('--league=') || a === '--league')
  const league = leagueArg
    ? (leagueArg.includes('=') ? leagueArg.split('=')[1] : args[args.indexOf('--league') + 1])?.toUpperCase() || 'NFL'
    : 'NFL'
  const teamIdArg = args.find((a) => a.startsWith('--team-id=') || a === '--team-id')
  const singleTeamId = teamIdArg
    ? (teamIdArg.includes('=') ? teamIdArg.split('=')[1] : args[args.indexOf('--team-id') + 1])
    : null
  const leagueId = LEAGUE_IDS[league] || ''

  console.log('\nâ•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—')
  console.log('â•‘   TheSportsDB Players Sync â€” BULK ROSTER (PRIMARY)       â•‘')
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•')
  console.log(`Mode:     ${apply ? 'APPLY (writes to DB)' : 'DRY RUN (no writes)'}`)
  console.log(`League:   ${league} (ID: ${leagueId || 'unknown'})`)
  console.log(`Key:      ${getTSDBKey() === '123' ? 'free (123) â€” 30/min' : 'premium â€” 100/min'}`)
  console.log(`Strategy: search_all_teams â†’ lookup_all_players per team (bulk)\n`)

  if (!leagueId) {
    console.error(`Unknown league: ${league}. Supported: ${Object.keys(LEAGUE_IDS).join(', ')}`)
    await prisma.$disconnect()
    return
  }

  // Step 1: Get teams
  let teams: TSDBTeam[] = []
  if (singleTeamId) {
    teams = [{ idTeam: singleTeamId, strTeam: 'Single Team', strTeamShort: null }]
    console.log(`Single-team mode: team ID ${singleTeamId}`)
  } else {
    console.log(`Fetching ${league} teams from TheSportsDB...`)
    teams = await getAllTeams(league, leagueId)
    console.log(`Found ${teams.length} teams\n`)
  }

  if (!teams.length) {
    console.error('No teams returned. Check league ID or key.')
    await prisma.$disconnect()
    return
  }

  // Step 2: For each team, fetch full roster
  let totalCreated = 0, totalUpdated = 0, totalSkipped = 0, totalErrors = 0
  let totalWithImage = 0, totalNoImage = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  for (const team of teams) {
    process.stdout.write(`  Fetching ${team.strTeam} (${team.idTeam})...`)
    const roster = await getTeamRoster(team.idTeam)
    await sleep(CALL_DELAY_MS)

    if (!roster.length) {
      console.log(` no players returned`)
      continue
    }

    console.log(` ${roster.length} players`)

    for (const player of roster) {
      const name = player.strPlayer?.trim()
      const pos = player.strPosition?.trim() || null
      const teamAbbrev = resolveTeam(player)
      const image = resolveImage(player)

      if (!name || !player.idPlayer) {
        totalSkipped++
        continue
      }

      if (!apply) {
        if (image) totalWithImage++
        else totalNoImage++
        continue
      }

      try {
        await prisma.sportsPlayer.upsert({
          where: {
            sport_externalId_source: {
              sport: league as any,
              externalId: `tsdb_${player.idPlayer}`,
              source: 'thesportsdb',
            },
          },
          update: {
            name,
            position: pos,
            team: teamAbbrev,
            teamId: player.idTeam || null,
            imageUrl: image,
            status: player.strStatus?.trim() || null,
            height: player.strHeight?.trim() || null,
            weight: player.strWeight?.trim() || null,
            college: player.strCollege?.trim() || null,
            fetchedAt: now,
            expiresAt,
          },
          create: {
            sport: league as any,
            externalId: `tsdb_${player.idPlayer}`,
            source: 'thesportsdb',
            name,
            position: pos,
            team: teamAbbrev,
            teamId: player.idTeam || null,
            imageUrl: image,
            status: player.strStatus?.trim() || null,
            height: player.strHeight?.trim() || null,
            weight: player.strWeight?.trim() || null,
            college: player.strCollege?.trim() || null,
            fetchedAt: now,
            expiresAt,
          },
        })
        totalUpdated++
        if (image) totalWithImage++
        else totalNoImage++
      } catch (e) {
        totalErrors++
        console.warn(`    Error upserting ${name}: ${e}`)
      }
    }
  }

  console.log('\nâ•â•â• RESULTS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•')
  console.log(`Teams processed:  ${teams.length}`)
  if (apply) {
    console.log(`DB rows written:  ${totalUpdated}`)
    console.log(`Errors:           ${totalErrors}`)
  }
  console.log(`With image:       ${totalWithImage}`)
  console.log(`No image:         ${totalNoImage}`)
  console.log(`Skipped:          ${totalSkipped}`)
  console.log(`\nCalls used:       ${teams.length + 1} total (1 teams list + 1 per team)`)
  console.log(`vs name-search:   would have required ~${(totalWithImage + totalNoImage) * 1.2 | 0} calls`)
  if (!apply) {
    console.log('\nDRY RUN â€” pass --apply to write to DB')
  } else {
    console.log('\nSync complete. Run sync-sleeper-players.ts --include-idp --apply for gaps.')
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})


/**
 * scripts/sync-sleeper-players.ts
 *
 * DB-first ingestion: Sleeper public NFL players API → sportsPlayer + sleeperId fields.
 *
 * Sleeper is the SECONDARY source of truth (fills gaps left by TheSportsDB).
 * Run sync-thesportsdb-players.ts FIRST, then this script to patch missing players.
 *
 * Sleeper is authoritative for:
 *   - Current team assignment (real-time — FA vs active roster)
 *   - Injury / active status (up-to-date for fantasy purposes)
 *   - IDP positions (DE, DT, LB, CB, S, DB, DL) — not all covered by TheSportsDB
 *
 * Image priority:
 *   - TheSportsDB strCutout/strRender images are preferred (transparent-bg, high quality)
 *   - Sleeper CDN thumb URLs are set ONLY when no valid https:// image already exists
 *   - The draft pool resolver (orderBy source desc) ensures TheSportsDB wins at runtime
 *
 * Usage:
 *   npx tsx scripts/sync-sleeper-players.ts           # dry run (prints report only)
 *   npx tsx scripts/sync-sleeper-players.ts --apply   # writes to DB
 *   npx tsx scripts/sync-sleeper-players.ts --apply --positions QB,RB,WR,TE,K,DEF  # filter positions
 *   npx tsx scripts/sync-sleeper-players.ts --apply --include-idp  # include IDP positions
 */

import { PrismaClient } from '@prisma/client'

import { vendorRowMayCarrySleeperId } from '@/lib/player-match/authoritativePlayerRow'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

const prisma = new PrismaClient()

const SLEEPER_API = 'https://api.sleeper.app/v1/players/nfl'
const SLEEPER_CDN_BASE = 'https://sleepercdn.com/content/nfl/players/thumb'

// Fantasy-relevant positions (skill positions + IDP)
const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
const IDP_POSITIONS = new Set(['DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'CB', 'S', 'FS', 'SS', 'DB', 'DL', 'DB'])
const ALL_POSITIONS = new Set([...SKILL_POSITIONS, ...IDP_POSITIONS])

interface SleeperPlayer {
  player_id: string
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  team?: string | null
  status?: string
  injury_status?: string | null
  injury_notes?: string | null
  years_exp?: number | null
  age?: number | null
  college?: string | null
  height?: string | null
  weight?: string | null
  number?: number | null
  sport?: string
  active?: boolean
  avatar?: string | null
}

function getSleeperHeadshotUrl(id: string, avatar: string | null | undefined): string | null {
  // Sleeper CDN always serves thumbs by player_id, regardless of whether avatar is set.
  // Some players have no actual photo uploaded, but the URL will 404 gracefully.
  return `${SLEEPER_CDN_BASE}/${id}.jpg`
}

function normalizeTeam(team: string | null | undefined): string | null {
  if (!team || team.trim() === '' || team.trim() === 'null') return null
  const t = team.trim().toUpperCase()
  // Common Sleeper team abbreviation normalizations
  const MAP: Record<string, string> = {
    'JAX': 'JAC',
  }
  return MAP[t] ?? t
}

function normalizePosition(pos: string | null | undefined): string | null {
  if (!pos) return null
  const p = pos.trim().toUpperCase()
  // Normalize position aliases
  const MAP: Record<string, string> = {
    'ILB': 'LB',
    'OLB': 'LB',
    'MLB': 'LB',
    'FS': 'S',
    'SS': 'S',
    'NT': 'DT',
    'DE': 'DE',  // keep
    'DL': 'DL',  // keep
    'DB': 'DB',  // keep
    'SPEC': null as unknown as string, // filter out
  }
  if (p in MAP) return MAP[p] || p
  return p
}

function playerFullName(p: SleeperPlayer): string {
  return p.full_name?.trim() ||
    [p.first_name, p.last_name].filter(Boolean).join(' ').trim() ||
    ''
}

function isFantasyRelevant(p: SleeperPlayer, includeIDP: boolean): boolean {
  const pos = (p.position || '').toUpperCase().trim()
  if (!pos) return false
  if (SKILL_POSITIONS.has(pos)) return true
  if (includeIDP && IDP_POSITIONS.has(pos)) return true
  return false
}

/** Treat null and 'FA' as the same (free agent) for team comparison purposes */
function teamForComparison(team: string | null | undefined): string | null {
  if (!team || team === 'FA') return null
  return team
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const includeIDP = args.includes('--include-idp')
  const posFilter = args.find(a => a.startsWith('--positions=') || a.startsWith('--positions'))
  let filterPositions: Set<string> | null = null
  
  if (posFilter) {
    const raw = posFilter.includes('=') ? posFilter.split('=')[1] : args[args.indexOf('--positions') + 1]
    if (raw) filterPositions = new Set(raw.split(',').map(p => p.trim().toUpperCase()))
  }
  
  console.log('\n=== Sleeper NFL Players Full Sync ===')
  console.log(`Mode:    ${apply ? 'APPLY (writes to DB)' : 'DRY RUN (no writes)'}`)
  console.log(`IDP:     ${includeIDP ? 'included' : 'skill positions only'}`)
  if (filterPositions) console.log(`Filter:  positions=${[...filterPositions].join(',')}`)
  console.log('')

  // --- 1. Fetch Sleeper ---
  console.log('Fetching Sleeper NFL players API...')
  const res = await fetch(SLEEPER_API)
  if (!res.ok) {
    console.error(`Sleeper API failed: ${res.status}`)
    process.exit(1)
  }
  const raw: Record<string, SleeperPlayer> = await res.json()
  const allSleeper = Object.entries(raw)
    .map(([id, p]) => ({ ...p, player_id: id }))
    .filter(p => p.sport === 'nfl' || !p.sport) // only NFL
    .filter(p => playerFullName(p).length > 1) // skip empty names

  console.log(`Sleeper total players: ${allSleeper.length}`)

  // Filter to fantasy-relevant
  const relevant = allSleeper.filter(p => {
    if (!isFantasyRelevant(p, includeIDP)) return false
    if (filterPositions) {
      const pos = normalizePosition(p.position) || ''
      return filterPositions.has(pos) || filterPositions.has((p.position || '').toUpperCase())
    }
    return true
  })

  console.log(`Fantasy-relevant (${includeIDP ? 'skill+IDP' : 'skill only'}): ${relevant.length}`)
  console.log('')

  // --- 2. Load current DB state ---
  console.log('Loading current sportsPlayer DB state...')
  const dbPlayers = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL' },
    select: { id: true, name: true, position: true, team: true, imageUrl: true, sleeperId: true, source: true, externalId: true },
  })
  console.log(`DB sportsPlayer rows (NFL): ${dbPlayers.length}`)

  // Index DB by sleeperId and by name+position. For a Sleeper id the Sleeper row itself wins:
  // a vendor row carrying the same id is at best a copy and at worst a namesake.
  const dbBySleeperId = new Map<string, typeof dbPlayers[0]>()
  const dbByNamePos = new Map<string, typeof dbPlayers[0]>()
  for (const row of dbPlayers) {
    if (row.sleeperId && (row.source === 'sleeper' || !dbBySleeperId.has(row.sleeperId))) dbBySleeperId.set(row.sleeperId, row)
    const nameKey = `${row.name?.toLowerCase().trim()}|${(row.position || '').toLowerCase()}`
    if (!dbByNamePos.has(nameKey)) dbByNamePos.set(nameKey, row)
  }

  // --- 3. Compare ---
  type Issue = { player_id: string; name: string; pos: string; team: string; issue: string; detail: string }
  const issues: Issue[] = []
  const toUpsert: Array<{
    sleeperPlayer: SleeperPlayer
    dbRow: typeof dbPlayers[0] | null
    action: 'create' | 'update_image' | 'update_team' | 'update_all'
  }> = []

  /*
   * 🛑 THE UPDATE BELOW STAMPS `sleeperId` ONTO WHATEVER ROW THE KEY FOUND, WHATEVER ITS
   * SOURCE — the only writer in the tree that puts a Sleeper id on another feed's row, and
   * it matched on name + exact position with no team and no namesake check. Measured
   * 2026-10-12: TheSportsDB's `tsdb_34249738` "Byron Murphy DT Seattle Seahawks" carries
   * 5864 — the Vikings CB — and every Sleeper-keyed read (leagues, projection, rank)
   * followed it to the wrong man. 727 of 2,247 TheSportsDB NFL rows carry a stamp, every one
   * created on or before 2026-04-26 and none of the 463 created since: a hand run, not a cron.
   * So a vendor row is now written only when `vendorRowMayCarrySleeperId` agrees: same name,
   * agreeing position group, same stated team, and a name unique in Sleeper's universe.
   * Anything else is refused and reported. Existing stamps are NOT touched here.
   */
  const sleeperNameCount = new Map<string, number>()
  for (const p of allSleeper) {
    const key = normalizeMatchName(playerFullName(p))
    if (key) sleeperNameCount.set(key, (sleeperNameCount.get(key) ?? 0) + 1)
  }
  let refusedVendorStamp = 0

  let missingInDb = 0
  let wrongTeam = 0
  let staleStatus = 0
  let noImage = 0

  for (const p of relevant) {
    const name = playerFullName(p)
    const pos = normalizePosition(p.position) || p.position || ''
    const team = normalizeTeam(p.team)
    const sleeperImage = getSleeperHeadshotUrl(p.player_id, p.avatar)
    
    // Find DB match
    const dbBySleeperMatch = dbBySleeperId.get(p.player_id)
    const nameKey = `${name.toLowerCase().trim()}|${pos.toLowerCase()}`
    const dbByNameMatch = dbByNamePos.get(nameKey)
    const dbRow = dbBySleeperMatch || dbByNameMatch || null

    if (
      dbRow &&
      dbRow.source !== 'sleeper' &&
      !vendorRowMayCarrySleeperId(
        { name, position: p.position ?? null, team },
        dbRow,
        sleeperNameCount.get(normalizeMatchName(name)) ?? 0,
      )
    ) {
      refusedVendorStamp++
      issues.push({ player_id: p.player_id, name, pos, team: team || 'FA', issue: 'REFUSED_VENDOR_STAMP', detail: `${dbRow.source} ${dbRow.externalId} "${dbRow.name}" ${dbRow.position ?? '-'} ${dbRow.team ?? 'FA'} is not verifiably this player` })
      continue
    }

    if (!dbRow) {
      // Only create players who are currently active AND on a roster
      // p.active===false means retired/historical — skip them
      if (team && team !== 'FA' && p.active !== false) {
        missingInDb++
        issues.push({ player_id: p.player_id, name, pos, team: team || 'FA', issue: 'MISSING_IN_DB', detail: `Active player not in sportsPlayer table` })
        toUpsert.push({ sleeperPlayer: p, dbRow: null, action: 'create' })
      }
      continue
    }

    const needsChanges: string[] = []
    
    // Check image — only replace if it's a broken UUID filename or null
    // Keep valid third-party images (TheSportsDB cutouts etc.) — those are real photos
    const currentImage = dbRow.imageUrl
    const isUuidFilename = currentImage && /^[0-9a-f-]{36}\.png$/i.test(currentImage)
    const isBrokenMotionUrl = currentImage && currentImage.includes('/media/motion/')
    const hasNoValidImage = !currentImage || isUuidFilename || isBrokenMotionUrl
    
    if (hasNoValidImage) {
      noImage++
      needsChanges.push('image')
      issues.push({ player_id: p.player_id, name, pos, team: team || 'FA', issue: 'NO_VALID_IMAGE', detail: `Current: "${currentImage || 'NULL'}" → will set Sleeper CDN` })
    }
    
    // Check team — treat null and 'FA' as equivalent
    const dbTeam = dbRow.team
    if (teamForComparison(team) !== teamForComparison(dbTeam)) {
      wrongTeam++
      needsChanges.push('team')
      issues.push({ player_id: p.player_id, name, pos, team: team || 'FA', issue: 'WRONG_TEAM', detail: `DB: "${dbTeam || 'NULL'}" → Sleeper: "${team || 'FA'}"` })
    }

    if (needsChanges.length > 0) {
      const action = needsChanges.length === 1 && needsChanges[0] === 'image' 
        ? 'update_image' 
        : needsChanges.length === 1 && needsChanges[0] === 'team'
        ? 'update_team'
        : 'update_all'
      toUpsert.push({ sleeperPlayer: p, dbRow, action })
    }
  }

  // --- 4. Print report ---
  console.log('=== COMPARISON REPORT ===')
  console.log(`Missing in DB (active):  ${missingInDb}`)
  console.log(`No/invalid image (UUID): ${noImage}`)
  console.log(`Wrong team:              ${wrongTeam}`)
  console.log(`Refused vendor stamps:   ${refusedVendorStamp}`)
  console.log(`Total to fix:            ${toUpsert.length}`)
  console.log('')

  // Print by issue type
  const byIssue = new Map<string, Issue[]>()
  for (const issue of issues) {
    if (!byIssue.has(issue.issue)) byIssue.set(issue.issue, [])
    byIssue.get(issue.issue)!.push(issue)
  }

  for (const [issueType, items] of byIssue) {
    console.log(`--- ${issueType} (${items.length}) ---`)
    for (const item of items.slice(0, 30)) {
      console.log(`  ${item.name.padEnd(25)} | ${item.pos.padEnd(3)} | ${item.team.padEnd(3)} | ${item.detail}`)
    }
    if (items.length > 30) console.log(`  ... and ${items.length - 30} more`)
    console.log('')
  }

  // --- 5. Upsert if --apply ---
  if (!apply) {
    console.log('DRY RUN: pass --apply to write changes to DB')
    console.log(`Would create ${toUpsert.filter(u => u.action === 'create').length} new players`)
    console.log(`Would update ${toUpsert.filter(u => u.action !== 'create').length} existing players`)
    await prisma.$disconnect()
    return
  }

  console.log('Applying changes...')
  let created = 0, updated = 0, errors = 0
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const now = new Date()

  for (const { sleeperPlayer: p, dbRow, action } of toUpsert) {
    const name = playerFullName(p)
    const pos = normalizePosition(p.position) || p.position || null
    const team = normalizeTeam(p.team)
    const imageUrl = getSleeperHeadshotUrl(p.player_id, p.avatar)
    const sleeperStatus = p.injury_status || p.status || null

    try {
      if (action === 'create' || !dbRow) {
        // Check if row exists by externalId/source combo before creating
        await prisma.sportsPlayer.upsert({
          where: {
            sport_externalId_source: {
              sport: 'NFL',
              externalId: `sleeper_${p.player_id}`,
              source: 'sleeper',
            },
          },
          update: {
            name,
            position: pos,
            team,
            imageUrl,
            sleeperId: p.player_id,
            status: sleeperStatus,
            age: p.age ?? null,
            college: p.college ?? null,
            height: p.height ?? null,
            weight: p.weight ? String(p.weight) : null,
            fetchedAt: now,
            expiresAt,
          },
          create: {
            sport: 'NFL',
            externalId: `sleeper_${p.player_id}`,
            source: 'sleeper',
            name,
            position: pos,
            team,
            imageUrl,
            sleeperId: p.player_id,
            status: sleeperStatus,
            age: p.age ?? null,
            college: p.college ?? null,
            height: p.height ?? null,
            weight: p.weight ? String(p.weight) : null,
            fetchedAt: now,
            expiresAt,
          },
        })
        created++
      } else {
        // Update existing row by ID — safe, no unique key conflicts
        const updateData: Record<string, unknown> = {
          sleeperId: p.player_id,
          fetchedAt: now,
          expiresAt,
        }
        if (action === 'update_image' || action === 'update_all') {
          updateData.imageUrl = imageUrl
        }
        if (action === 'update_team' || action === 'update_all') {
          updateData.team = team
          updateData.status = sleeperStatus
        }
        
        await prisma.sportsPlayer.update({
          where: { id: dbRow.id },
          data: updateData,
        })
        updated++
      }
    } catch (e: unknown) {
      errors++
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('Unique constraint')) {
        console.error(`  ✗ Failed ${name}: ${msg.substring(0, 100)}`)
      }
    }
  }

  console.log('')
  console.log('=== SYNC COMPLETE ===')
  console.log(`Created: ${created}`)
  console.log(`Updated: ${updated}`)
  console.log(`Errors:  ${errors}`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

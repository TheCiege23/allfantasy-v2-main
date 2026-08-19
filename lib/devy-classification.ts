import { prisma } from '@/lib/prisma'
import {
  getCFBPlayerStats, getCFBTeamRoster, getCFBDraftPicks,
  getCFBRecruits, getCFBTransferPortal, getCFBReturningProduction,
  getCFBPlayerUsage, getCFBPlayerPPA, getCFBSPRatings,
  getCFBPlayerWEPAPassing, getCFBPlayerWEPARushing,
  type CFBPlayer, type CFBPlayerStats, type CFBDraftPick,
  type CFBRecruit, type CFBTransferPortalEntry, type CFBReturningProduction,
  type CFBPlayerUsage, type CFBPlayerPPA, type CFBTeamSPRating, type CFBPlayerWEPA,
} from '@/lib/cfb-player-data'
import { computeAllDevyIntelMetrics } from '@/lib/devy-intel'

export type DraftStatus = 'college' | 'declared' | 'drafted' | 'nfl_active' | 'returning'

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function calculateDraftEligibleYear(classYear: number | null): number {
  const currentYear = new Date().getFullYear()
  if (!classYear) return currentYear + 3
  const yearsRemaining = Math.max(0, 4 - classYear)
  return currentYear + yearsRemaining
}

function calculateDevyValueFromStats(
  position: string,
  classYear: number | null,
  projectedRound: number | null,
  stats?: { passingYards?: number; rushingYards?: number; receivingYards?: number; receptions?: number; passingTDs?: number; rushingTDs?: number; receivingTDs?: number }
): number {
  const baseValues: Record<string, number> = { QB: 6000, RB: 4500, WR: 5000, TE: 3500 }
  let value = baseValues[position] || 2000

  const classMultipliers: Record<number, number> = { 1: 1.4, 2: 1.3, 3: 1.1, 4: 1.0, 5: 0.9 }
  value *= classMultipliers[classYear || 4] || 1.0

  if (projectedRound) {
    const roundMults: Record<number, number> = { 1: 1.8, 2: 1.4, 3: 1.1, 4: 0.9, 5: 0.7, 6: 0.5, 7: 0.3 }
    value *= roundMults[projectedRound] || 0.5
  }

  if (stats) {
    if (position === 'QB') {
      value += Math.min((stats.passingYards || 0) / 100, 1500)
      value += (stats.passingTDs || 0) * 30
    }
    if (position === 'RB') {
      value += Math.min((stats.rushingYards || 0) / 50, 1200)
      value += (stats.rushingTDs || 0) * 40
    }
    if (position === 'WR' || position === 'TE') {
      value += Math.min((stats.receivingYards || 0) / 50, 1200)
      value += (stats.receivingTDs || 0) * 40
      value += Math.min((stats.receptions || 0) * 5, 400)
    }
  }

  return Math.round(value)
}

export function computeAvailabilityPct(
  devyValue: number,
  draftEligibleYear: number,
  pickNumber: number,
  totalTeams: number
): number {
  const currentYear = new Date().getFullYear()
  const yearsOut = draftEligibleYear - currentYear
  const pickPosition = pickNumber / totalTeams

  const valuePercentile = Math.min(1, Math.max(0, devyValue / 10000))
  const baseDraftProb = 1 - valuePercentile

  let availability = baseDraftProb * 100

  if (yearsOut >= 2) availability = Math.min(95, availability + 15)
  else if (yearsOut === 1) availability = availability
  else availability = Math.max(5, availability - 20)

  availability *= (0.5 + pickPosition * 0.5)

  return Math.round(Math.min(95, Math.max(5, availability)))
}

export interface DevySyncResult {
  ingested: number
  graduated: number
  classified: number
  statusBreakdown: Record<DraftStatus, number>
  errors: string[]
}

export interface ClassificationResult {
  total: number
  college: number
  declared: number
  drafted: number
  nflActive: number
  returning: number
  errors: string[]
}

const TOP_CFB_TEAMS = [
  'Alabama', 'Ohio State', 'Georgia', 'Texas', 'Michigan', 'USC', 'Oregon',
  'Penn State', 'LSU', 'Clemson', 'Notre Dame', 'Florida State', 'Tennessee',
  'Oklahoma', 'Florida', 'Texas A&M', 'Wisconsin', 'Iowa', 'Miami',
  'Ole Miss', 'Colorado', 'Auburn', 'Nebraska', 'Kentucky', 'Arkansas',
  'North Carolina', 'Missouri', 'Utah', 'Washington', 'UCLA',
  'Oklahoma State', 'Kansas State', 'Baylor', 'Duke', 'Pittsburgh',
  'Louisville', 'Virginia Tech', 'West Virginia', 'South Carolina',
  'Mississippi State', 'Arizona', 'Arizona State', 'Stanford', 'California',
  'TCU', 'SMU', 'BYU', 'Boise State', 'Memphis', 'Tulane',
]

const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE'])

export async function ingestCFBDRosters(season?: number): Promise<{ ingested: number; rosterYear: number; errors: string[] }> {
  const currentYear = new Date().getFullYear()
  let year = season || currentYear
  let ingested = 0
  const errors: string[] = []

  const testRoster = await getCFBTeamRoster('Alabama', year)
  if (testRoster.length === 0 && year === currentYear) {
    year = currentYear - 1
    console.log(`[DevySync] Current year roster not available, falling back to ${year}`)
  }

  for (const team of TOP_CFB_TEAMS) {
    try {
      const roster = await getCFBTeamRoster(team, year)
      const fantasyPlayers = roster.filter(p => FANTASY_POSITIONS.has(p.position))

      for (const p of fantasyPlayers) {
        const normalizedName = normalizeName(p.fullName)
        if (!normalizedName || normalizedName.length < 3) continue

        const draftEligibleYear = calculateDraftEligibleYear(p.year)

        try {
          await prisma.devyPlayer.upsert({
            where: {
              uniq_devy_player: {
                normalizedName,
                position: p.position,
                school: team,
              },
            },
            create: {
              name: p.fullName,
              normalizedName,
              position: p.position,
              school: team,
              sport: 'NCAAF',
              classYearLabel:
                p.year != null
                  ? p.year <= 1
                    ? 'FR'
                    : p.year === 2
                      ? 'SO'
                      : p.year === 3
                        ? 'JR'
                        : p.year === 4
                          ? 'SR'
                          : 'GR'
                  : null,
              classYear: p.year,
              heightInches: p.height,
              weightLbs: p.weight,
              cfbdId: p.id ? String(p.id) : null,
              draftEligibleYear,
              league: 'NCAA',
              devyEligible: true,
              graduatedToNFL: false,
              draftStatus: 'college',
              statusSource: 'cfbd_roster',
              statusConfidence: 90,
              ncaaSourceTag: 'ncaaf_cfbd',
              statusUpdatedAt: new Date(),
              lastRosterYear: year,
              source: 'cfbd',
              lastSyncedAt: new Date(),
            },
            update: {
              sport: 'NCAAF',
              classYearLabel:
                p.year != null
                  ? p.year <= 1
                    ? 'FR'
                    : p.year === 2
                      ? 'SO'
                      : p.year === 3
                        ? 'JR'
                        : p.year === 4
                          ? 'SR'
                          : 'GR'
                  : null,
              classYear: p.year,
              heightInches: p.height,
              weightLbs: p.weight,
              cfbdId: p.id ? String(p.id) : null,
              draftEligibleYear,
              ncaaSourceTag: 'ncaaf_cfbd',
              lastRosterYear: year,
              lastSyncedAt: new Date(),
            },
          })
          ingested++
        } catch (dbErr: any) {
          errors.push(`DB upsert failed for ${p.fullName}: ${dbErr.message?.slice(0, 100)}`)
        }
      }

      await new Promise(r => setTimeout(r, 200))
    } catch (err: any) {
      errors.push(`Team ${team} fetch failed: ${err.message?.slice(0, 100)}`)
    }
  }

  return { ingested, rosterYear: year, errors }
}

export async function ingestCFBDStats(season?: number): Promise<{ updated: number; errors: string[] }> {
  const year = season || new Date().getFullYear() - 1
  let updated = 0
  const errors: string[] = []

  for (const team of TOP_CFB_TEAMS.slice(0, 25)) {
    try {
      const stats = await getCFBPlayerStats(year, team)

      for (const s of stats) {
        if (!s.playerName) continue
        const normalizedName = normalizeName(s.playerName)

        try {
          const existing = await prisma.devyPlayer.findFirst({
            where: { normalizedName, school: team },
          })
          if (!existing) continue

          const devyValue = calculateDevyValueFromStats(
            existing.position,
            existing.classYear,
            existing.draftRound,
            {
              passingYards: s.passingYards,
              passingTDs: s.passingTDs,
              rushingYards: s.rushingYards,
              rushingTDs: s.rushingTDs,
              receivingYards: s.receivingYards,
              receivingTDs: s.receivingTDs,
              receptions: s.receptions,
            }
          )

          await prisma.devyPlayer.update({
            where: { id: existing.id },
            data: {
              passingYards: s.passingYards || null,
              passingTDs: s.passingTDs || null,
              rushingYards: s.rushingYards || null,
              rushingTDs: s.rushingTDs || null,
              receivingYards: s.receivingYards || null,
              receivingTDs: s.receivingTDs || null,
              receptions: s.receptions || null,
              statsPayload: {
                passingYards: s.passingYards || null,
                passingTDs: s.passingTDs || null,
                rushingYards: s.rushingYards || null,
                rushingTDs: s.rushingTDs || null,
                receivingYards: s.receivingYards || null,
                receivingTDs: s.receivingTDs || null,
                receptions: s.receptions || null,
              },
              statSeason: year,
              devyValue,
              lastSyncedAt: new Date(),
            },
          })
          updated++
        } catch (dbErr: any) {
          errors.push(`Stats update failed for ${s.playerName}: ${dbErr.message?.slice(0, 100)}`)
        }
      }

      await new Promise(r => setTimeout(r, 200))
    } catch (err: any) {
      errors.push(`Team ${team} stats failed: ${err.message?.slice(0, 100)}`)
    }
  }

  return { updated, errors }
}

function normalizePosition(pos: string): string {
  const lower = pos.toLowerCase().trim()
  const map: Record<string, string> = {
    quarterback: 'QB', 'running back': 'RB', 'wide receiver': 'WR',
    'tight end': 'TE', qb: 'QB', rb: 'RB', wr: 'WR', te: 'TE',
    'offensive lineman': 'OL', 'offensive tackle': 'OL', 'offensive guard': 'OL',
    'center': 'OL', 'defensive lineman': 'DL', 'defensive tackle': 'DT',
    'defensive end': 'DE', 'defensive edge': 'EDGE',
    linebacker: 'LB', 'inside linebacker': 'LB', 'outside linebacker': 'LB',
    'defensive back': 'DB', 'corner back': 'DB', cornerback: 'DB',
    safety: 'DB', kicker: 'K', punter: 'P', 'place kicker': 'K',
    ath: 'ATH', athlete: 'ATH', 'kick returner': 'WR',
  }
  if (map[lower]) return map[lower]
  if (lower.includes('/')) {
    const parts = lower.split('/')
    for (const p of parts) {
      if (map[p.trim()]) return map[p.trim()]
    }
  }
  return pos.toUpperCase()
}

function positionsMatch(pos1: string, pos2: string): boolean {
  if (pos1 === pos2) return true
  const n1 = normalizePosition(pos1)
  const n2 = normalizePosition(pos2)
  if (n1 === n2) return true
  if (n1 === 'ATH' || n2 === 'ATH') return true
  return false
}

export async function classifyDraftStatus(rosterYear: number): Promise<ClassificationResult> {
  const currentYear = new Date().getFullYear()
  const now = new Date()
  const result: ClassificationResult = {
    total: 0, college: 0, declared: 0, drafted: 0, nflActive: 0, returning: 0, errors: []
  }

  console.log('[ClassifyStatus] Building NFL player index from Sleeper...')
  let nflNameMap = new Map<string, { id: string; team: string; position: string; status: string; yearsExp: number }>()
  try {
    const sleeperRes = await fetch('https://api.sleeper.app/v1/players/nfl') // db-first-exception: devy backfill utility path pending DB mirror
    if (sleeperRes.ok) {
      const nflPlayers: Record<string, any> = await sleeperRes.json()
      for (const [id, p] of Object.entries(nflPlayers)) {
        if (!p) continue
        const name = normalizeName(`${p.first_name || ''} ${p.last_name || ''}`)
        if (name.length < 3) continue
        nflNameMap.set(name, {
          id,
          team: p.team || '',
          position: p.position || '',
          status: p.status || '',
          yearsExp: p.years_exp || 0,
        })
      }
      console.log(`[ClassifyStatus] Sleeper index: ${nflNameMap.size} NFL players`)
    } else {
      result.errors.push('Failed to fetch Sleeper NFL players')
    }
  } catch (err: any) {
    result.errors.push(`Sleeper fetch error: ${err.message?.slice(0, 100)}`)
  }

  console.log('[ClassifyStatus] Fetching CFBD draft picks...')
  const draftPicksByName = new Map<string, CFBDraftPick[]>()
  const draftYearsToCheck = [currentYear, currentYear - 1]
  for (const draftYear of draftYearsToCheck) {
    try {
      const picks = await getCFBDraftPicks(draftYear)
      for (const pick of picks) {
        if (!pick.playerName) continue
        const normalizedPickName = normalizeName(pick.playerName)
        if (normalizedPickName.length < 3) continue
        const existing = draftPicksByName.get(normalizedPickName) || []
        existing.push(pick)
        draftPicksByName.set(normalizedPickName, existing)
      }
      console.log(`[ClassifyStatus] CFBD draft ${draftYear}: ${picks.length} picks loaded`)
      await new Promise(r => setTimeout(r, 300))
    } catch (err: any) {
      result.errors.push(`Draft picks ${draftYear} fetch error: ${err.message?.slice(0, 100)}`)
    }
  }

  console.log('[ClassifyStatus] Building current roster index from CFBD...')
  const currentRosterSet = new Set<string>()
  for (const team of TOP_CFB_TEAMS) {
    try {
      const roster = await getCFBTeamRoster(team, rosterYear)
      for (const p of roster) {
        if (!FANTASY_POSITIONS.has(p.position)) continue
        const key = `${normalizeName(p.fullName)}|${p.position}|${team}`
        currentRosterSet.add(key)
      }
      await new Promise(r => setTimeout(r, 100))
    } catch {
    }
  }
  console.log(`[ClassifyStatus] Current roster index: ${currentRosterSet.size} players on ${rosterYear} rosters`)

  const allDevyPlayers = await prisma.devyPlayer.findMany()
  console.log(`[ClassifyStatus] Classifying ${allDevyPlayers.length} devy players...`)
  result.total = allDevyPlayers.length

  for (const player of allDevyPlayers) {
    const normalizedName = player.normalizedName || normalizeName(player.name)
    let newStatus: DraftStatus = 'college'
    let statusSource = ''
    let confidence = 0
    let nflTeam: string | null = player.nflTeam
    let sleeperId: string | null = player.sleeperId
    let draftYear: number | null = player.draftYear
    let nflDraftRound: number | null = player.nflDraftRound
    let nflDraftPick: number | null = player.nflDraftPick
    let devyEligible = player.devyEligible
    let graduatedToNFL = player.graduatedToNFL
    let league = player.league

    const nflMatch = nflNameMap.get(normalizedName)
    if (nflMatch && positionsMatch(nflMatch.position, player.position)) {
      newStatus = 'nfl_active'
      statusSource = 'sleeper'
      confidence = 95
      nflTeam = nflMatch.team
      sleeperId = nflMatch.id
      devyEligible = false
      graduatedToNFL = true
      league = 'NFL'
      result.nflActive++
    } else {
      const draftPickCandidates = draftPicksByName.get(normalizedName) || []
      const draftPick = draftPickCandidates.find(dp => {
        const schoolMatch = normalizeName(dp.collegeTeam) === normalizeName(player.school)
        const posMatch = !dp.position || positionsMatch(dp.position, player.position)
        return schoolMatch && posMatch
      }) || (draftPickCandidates.length === 1 ? draftPickCandidates[0] : null)

      if (draftPick) {
        newStatus = 'drafted'
        statusSource = 'cfbd_draft'
        confidence = 95
        nflTeam = draftPick.nflTeam || nflTeam
        draftYear = draftPick.year
        nflDraftRound = draftPick.round
        nflDraftPick = draftPick.overallPick
        devyEligible = false
        graduatedToNFL = true
        league = 'NFL'
        result.drafted++
      } else {
        const rosterKey = `${normalizedName}|${player.position}|${player.school}`
        const onCurrentRoster = currentRosterSet.has(rosterKey)

        if (onCurrentRoster) {
          const eligYear = player.draftEligibleYear || calculateDraftEligibleYear(player.classYear)
          const classYr = player.classYear || 0

          if (classYr >= 5 || (classYr >= 4 && eligYear < currentYear)) {
            newStatus = 'returning'
            statusSource = 'cfbd_roster+5th_year_or_past_eligible'
            confidence = 85
            result.returning++
          } else {
            newStatus = 'college'
            statusSource = 'cfbd_roster'
            confidence = 90
            result.college++
          }
          devyEligible = true
          graduatedToNFL = false
          league = 'NCAA'
        } else {
          const eligYear = player.draftEligibleYear || calculateDraftEligibleYear(player.classYear)
          const classYr = player.classYear || 0

          if (eligYear <= currentYear && classYr >= 4) {
            newStatus = 'declared'
            statusSource = 'inferred_senior_not_on_roster'
            confidence = 80
            devyEligible = false
            graduatedToNFL = false
            league = 'NCAA'
            result.declared++
          } else if (eligYear <= currentYear && classYr >= 3) {
            newStatus = 'declared'
            statusSource = 'inferred_early_declare'
            confidence = 65
            devyEligible = false
            graduatedToNFL = false
            league = 'NCAA'
            result.declared++
          } else {
            if (player.lastRosterYear && player.lastRosterYear >= rosterYear - 1) {
              newStatus = 'college'
              statusSource = 'last_roster_year'
              confidence = 60
              result.college++
            } else {
              newStatus = 'college'
              statusSource = 'default'
              confidence = 40
              result.college++
            }
            devyEligible = true
            graduatedToNFL = false
            league = 'NCAA'
          }
        }
      }
    }

    const statusChanged = player.draftStatus !== newStatus

    try {
      await prisma.devyPlayer.update({
        where: { id: player.id },
        data: {
          draftStatus: newStatus,
          statusSource,
          statusConfidence: confidence,
          statusUpdatedAt: now,
          devyEligible,
          graduatedToNFL,
          league,
          nflTeam,
          sleeperId,
          draftYear,
          nflDraftRound,
          nflDraftPick,
          lastClassifiedAt: now,
          lastSyncedAt: now,
        },
      })

      if (statusChanged) {
        console.log(`[ClassifyStatus] ${player.name} (${player.school}): ${player.draftStatus} → ${newStatus} [${statusSource}, ${confidence}%]`)
      }
    } catch (dbErr: any) {
      result.errors.push(`Update failed for ${player.name}: ${dbErr.message?.slice(0, 100)}`)
    }
  }

  console.log(`[ClassifyStatus] Complete: college=${result.college}, declared=${result.declared}, drafted=${result.drafted}, nfl_active=${result.nflActive}, returning=${result.returning}`)
  return result
}

/**
 * Recompute and persist devy intel metrics.
 *
 * `limit` drains oldest-enriched-first so a cron on a 60s budget can work
 * through the board across runs instead of timing out on all ~1,700 players.
 * Omit it for a full pass (scripts and one-off backfills).
 *
 * Safe to run only because computeAllDevyIntelMetrics now returns null for
 * unevidenced fields — before that it would have written a manufactured
 * recruitingComposite of 0.75 to every player lacking recruiting data.
 */
export async function enrichDevyIntelMetrics(
  options?: { limit?: number },
): Promise<{ updated: number; errors: string[] }> {
  let updated = 0
  const errors: string[] = []

  const players = await prisma.devyPlayer.findMany({
    where: { devyEligible: true, graduatedToNFL: false, league: 'NCAA' },
    orderBy: { lastSyncedAt: 'asc' },
    ...(options?.limit ? { take: options.limit } : {}),
  })

  for (const player of players) {
    try {
      const metrics = computeAllDevyIntelMetrics(player)

      await prisma.devyPlayer.update({
        where: { id: player.id },
        data: {
          recruitingComposite: metrics.recruitingComposite,
          breakoutAge: metrics.breakoutAge,
          draftProjectionScore: metrics.draftProjectionScore,
          projectedDraftRound: metrics.projectedDraftRound,
          projectedDraftPick: metrics.projectedDraftPick,
          athleticProfileScore: metrics.athleticProfileScore,
          productionIndex: metrics.productionIndex,
          nilImpactScore: metrics.nilImpactScore,
          injurySeverityScore: metrics.injurySeverityScore,
          volatilityScore: metrics.volatilityScore,
          lastSyncedAt: new Date(),
        },
      })
      updated++
    } catch (err: any) {
      errors.push(`Intel enrichment failed for ${player.name}: ${err.message?.slice(0, 100)}`)
    }
  }

  return { updated, errors }
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2: Recruiting Data Ingestion
// ──────────────────────────────────────────────────────────────────

export async function ingestCFBDRecruitingData(season?: number): Promise<{ updated: number; errors: string[] }> {
  const currentYear = new Date().getFullYear()
  let updated = 0
  const errors: string[] = []

  const recruitYears = season
    ? [season]
    : [currentYear, currentYear - 1, currentYear - 2, currentYear - 3]

  for (const year of recruitYears) {
    try {
      const recruits = await getCFBRecruits(year)
      if (!recruits.length) continue

      const recruitMap = new Map<string, CFBRecruit>()
      for (const r of recruits) {
        if (!r.name || !r.committedTo) continue
        const key = `${normalizeName(r.name)}|${r.committedTo}`
        if (!recruitMap.has(key) || (r.rating > (recruitMap.get(key)?.rating || 0))) {
          recruitMap.set(key, r)
        }
      }

      for (const [, recruit] of recruitMap) {
        const normalizedName = normalizeName(recruit.name)
        if (!normalizedName || normalizedName.length < 3) continue

        const pos = recruit.position ? normalizePosition(recruit.position) : null
        if (!pos || !FANTASY_POSITIONS.has(pos)) continue

        try {
          const existing = await prisma.devyPlayer.findFirst({
            where: {
              normalizedName,
              school: recruit.committedTo!,
            },
          })
          if (!existing) continue

          await prisma.devyPlayer.update({
            where: { id: existing.id },
            data: {
              recruitingStars: recruit.stars || existing.recruitingStars,
              recruitingComposite: recruit.rating || existing.recruitingComposite,
              recruitingRanking: recruit.ranking || existing.recruitingRanking,
              recruitingCity: recruit.city || existing.recruitingCity,
              recruitingState: recruit.stateProvince || existing.recruitingState,
              lastSyncedAt: new Date(),
            },
          })
          updated++
        } catch (dbErr: any) {
          errors.push(`Recruiting update failed for ${recruit.name}: ${dbErr.message?.slice(0, 80)}`)
        }
      }

      await new Promise(r => setTimeout(r, 200))
    } catch (err: any) {
      errors.push(`Recruiting year ${year} failed: ${err.message?.slice(0, 100)}`)
    }
  }

  return { updated, errors }
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2: Transfer Portal Ingestion
// ──────────────────────────────────────────────────────────────────

export async function ingestCFBDTransferPortal(season?: number): Promise<{ updated: number; errors: string[] }> {
  const currentYear = new Date().getFullYear()
  const year = season || currentYear
  let updated = 0
  const errors: string[] = []

  try {
    const transfers = await getCFBTransferPortal(year)
    if (!transfers.length) {
      console.log(`[DevySync] No transfer portal data for ${year}`)
      return { updated, errors }
    }

    console.log(`[DevySync] Processing ${transfers.length} transfer portal entries for ${year}`)

    for (const t of transfers) {
      if (!t.fullName) continue
      const normalizedName = normalizeName(t.fullName)
      if (!normalizedName || normalizedName.length < 3) continue

      try {
        const existing = await prisma.devyPlayer.findFirst({
          where: {
            normalizedName,
            OR: [
              { school: t.origin },
              { school: t.destination || '__none__' },
            ],
          },
        })
        if (!existing) continue

        const updateData: any = {
          transferStatus: true,
          transferFromSchool: t.origin,
          lastSyncedAt: new Date(),
        }

        if (t.destination) {
          updateData.transferToSchool = t.destination
          updateData.school = t.destination
        }

        if (t.eligibility) {
          updateData.transferEligibility = t.eligibility
        }

        if (t.stars != null && t.stars > 0) {
          updateData.recruitingStars = t.stars
        }
        if (t.rating != null && t.rating > 0) {
          updateData.recruitingComposite = t.rating
        }

        await prisma.devyPlayer.update({
          where: { id: existing.id },
          data: updateData,
        })
        updated++
      } catch (dbErr: any) {
        errors.push(`Transfer update failed for ${t.fullName}: ${dbErr.message?.slice(0, 80)}`)
      }
    }
  } catch (err: any) {
    errors.push(`Transfer portal fetch failed: ${err.message?.slice(0, 100)}`)
  }

  return { updated, errors }
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2: Player Usage & PPA Ingestion
// ──────────────────────────────────────────────────────────────────

export async function ingestCFBDUsageAndPPA(season?: number): Promise<{ updated: number; errors: string[] }> {
  const year = season || new Date().getFullYear() - 1
  let updated = 0
  const errors: string[] = []

  try {
    const [usage, ppa, wepaPassing, wepaRushing] = await Promise.all([
      getCFBPlayerUsage(year),
      getCFBPlayerPPA(year),
      getCFBPlayerWEPAPassing(year),
      getCFBPlayerWEPARushing(year),
    ])

    const teamSet = new Set(TOP_CFB_TEAMS)

    const usageByTeam = new Map<string, Map<string, CFBPlayerUsage>>()
    for (const u of usage) {
      if (!u.name || !u.team || !teamSet.has(u.team)) continue
      if (!usageByTeam.has(u.team)) usageByTeam.set(u.team, new Map())
      usageByTeam.get(u.team)!.set(normalizeName(u.name), u)
    }

    const ppaByTeam = new Map<string, Map<string, CFBPlayerPPA>>()
    for (const p of ppa) {
      if (!p.name || !p.team || !teamSet.has(p.team)) continue
      if (!ppaByTeam.has(p.team)) ppaByTeam.set(p.team, new Map())
      ppaByTeam.get(p.team)!.set(normalizeName(p.name), p)
    }

    const wepaPassByTeam = new Map<string, Map<string, CFBPlayerWEPA>>()
    for (const w of wepaPassing) {
      if (!w.playerName || !w.team || !teamSet.has(w.team)) continue
      if (!wepaPassByTeam.has(w.team)) wepaPassByTeam.set(w.team, new Map())
      wepaPassByTeam.get(w.team)!.set(normalizeName(w.playerName), w)
    }

    const wepaRushByTeam = new Map<string, Map<string, CFBPlayerWEPA>>()
    for (const w of wepaRushing) {
      if (!w.playerName || !w.team || !teamSet.has(w.team)) continue
      if (!wepaRushByTeam.has(w.team)) wepaRushByTeam.set(w.team, new Map())
      wepaRushByTeam.get(w.team)!.set(normalizeName(w.playerName), w)
    }

    for (const team of TOP_CFB_TEAMS) {
      const usageMap = usageByTeam.get(team) || new Map()
      const ppaMap = ppaByTeam.get(team) || new Map()
      const wepaPassMap = wepaPassByTeam.get(team) || new Map()
      const wepaRushMap = wepaRushByTeam.get(team) || new Map()

      const allNames = new Set([
        ...usageMap.keys(), ...ppaMap.keys(),
        ...wepaPassMap.keys(), ...wepaRushMap.keys(),
      ])

      for (const name of allNames) {
        try {
          const existing = await prisma.devyPlayer.findFirst({
            where: { normalizedName: name, school: team },
          })
          if (!existing) continue

          const u = usageMap.get(name)
          const p = ppaMap.get(name)
          const wp = wepaPassMap.get(name)
          const wr = wepaRushMap.get(name)

          const updateData: any = { lastSyncedAt: new Date() }

          if (u) {
            if (u.upiOverall != null) updateData.usageOverall = u.upiOverall
            if (u.upiPass != null) updateData.usagePass = u.upiPass
            if (u.upiRush != null) updateData.usageRush = u.upiRush
          }

          if (p) {
            if (p.averagePPAAll != null) updateData.ppaTotal = p.averagePPAAll
            if (p.averagePPAPass != null) updateData.ppaPass = p.averagePPAPass
            if (p.averagePPARush != null) updateData.ppaRush = p.averagePPARush
          }

          if (wp && wp.weightedEPA != null) {
            updateData.wepaPass = wp.weightedEPA
            if (!updateData.wepaTotal) updateData.wepaTotal = wp.weightedEPA
          }
          if (wr && wr.weightedEPA != null) {
            updateData.wepaRush = wr.weightedEPA
            updateData.wepaTotal = (updateData.wepaTotal || 0) + wr.weightedEPA
          }

          if (Object.keys(updateData).length > 1) {
            await prisma.devyPlayer.update({
              where: { id: existing.id },
              data: updateData,
            })
            updated++
          }
        } catch (dbErr: any) {
          errors.push(`Usage/PPA update failed for ${name}: ${dbErr.message?.slice(0, 80)}`)
        }
      }
    }
  } catch (err: any) {
    errors.push(`Usage/PPA bulk fetch failed: ${err.message?.slice(0, 100)}`)
  }

  return { updated, errors }
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2: Returning Production & SP+ Team Context Ingestion
// ──────────────────────────────────────────────────────────────────

export async function ingestCFBDTeamContext(season?: number): Promise<{ updated: number; errors: string[] }> {
  const year = season || new Date().getFullYear()
  let updated = 0
  const errors: string[] = []

  try {
    const [returningProd, spRatings] = await Promise.all([
      getCFBReturningProduction(year),
      getCFBSPRatings(year > 2024 ? year - 1 : year),
    ])

    const rpMap = new Map<string, CFBReturningProduction>()
    for (const r of returningProd) {
      if (r.team) rpMap.set(r.team, r)
    }

    const spMap = new Map<string, CFBTeamSPRating>()
    for (const s of spRatings) {
      if (s.team) spMap.set(s.team, s)
    }

    for (const team of TOP_CFB_TEAMS) {
      const rp = rpMap.get(team)
      const sp = spMap.get(team)
      if (!rp && !sp) continue

      try {
        const updateData: any = { lastSyncedAt: new Date() }

        if (rp && rp.percentPPA != null) {
          updateData.returningProdPct = rp.percentPPA
        }

        if (sp && sp.rating != null) {
          updateData.teamSpRating = sp.rating
        }

        const teamPlayers = await prisma.devyPlayer.findMany({
          where: { school: team, devyEligible: true },
          select: { id: true },
        })

        if (teamPlayers.length > 0) {
          await prisma.devyPlayer.updateMany({
            where: { id: { in: teamPlayers.map(p => p.id) } },
            data: updateData,
          })
          updated += teamPlayers.length
        }
      } catch (dbErr: any) {
        errors.push(`Team context update failed for ${team}: ${dbErr.message?.slice(0, 80)}`)
      }
    }
  } catch (err: any) {
    errors.push(`Team context fetch failed: ${err.message?.slice(0, 100)}`)
  }

  return { updated, errors }
}

export async function runFullDevySync(season?: number): Promise<DevySyncResult> {
  console.log('[DevySync] Starting full devy sync...')

  const roster = await ingestCFBDRosters(season)
  console.log(`[DevySync] Ingested ${roster.ingested} players from ${TOP_CFB_TEAMS.length} teams (roster year: ${roster.rosterYear})`)

  const stats = await ingestCFBDStats(season)
  console.log(`[DevySync] Updated stats for ${stats.updated} players`)

  const recruiting = await ingestCFBDRecruitingData(season)
  console.log(`[DevySync] Updated recruiting data for ${recruiting.updated} players`)

  const portal = await ingestCFBDTransferPortal(season)
  console.log(`[DevySync] Updated transfer portal data for ${portal.updated} players`)

  const usagePpa = await ingestCFBDUsageAndPPA(season)
  console.log(`[DevySync] Updated usage/PPA for ${usagePpa.updated} players`)

  const teamCtx = await ingestCFBDTeamContext(season)
  console.log(`[DevySync] Updated team context (SP+/returning prod) for ${teamCtx.updated} players`)

  const classification = await classifyDraftStatus(roster.rosterYear)
  console.log(`[DevySync] Classification complete: ${JSON.stringify({
    college: classification.college,
    declared: classification.declared,
    drafted: classification.drafted,
    nflActive: classification.nflActive,
    returning: classification.returning,
  })}`)

  const intel = await enrichDevyIntelMetrics()
  console.log(`[DevySync] Enriched intel metrics for ${intel.updated} players`)

  return {
    ingested: roster.ingested,
    graduated: classification.drafted + classification.nflActive,
    classified: classification.total,
    statusBreakdown: {
      college: classification.college,
      declared: classification.declared,
      drafted: classification.drafted,
      nfl_active: classification.nflActive,
      returning: classification.returning,
    },
    errors: [
      ...roster.errors, ...stats.errors, ...recruiting.errors,
      ...portal.errors, ...usagePpa.errors, ...teamCtx.errors,
      ...classification.errors, ...intel.errors,
    ],
  }
}

export async function getEligibleDevyPlayers(opts?: {
  position?: string
  limit?: number
  minValue?: number
  draftEligibleYear?: number
  draftStatus?: DraftStatus
}): Promise<any[]> {
  const where: any = {
    devyEligible: true,
    graduatedToNFL: false,
    league: 'NCAA',
  }
  if (opts?.position) where.position = opts.position
  if (opts?.minValue) where.devyValue = { gte: opts.minValue }
  if (opts?.draftEligibleYear) where.draftEligibleYear = opts.draftEligibleYear
  if (opts?.draftStatus) where.draftStatus = opts.draftStatus

  return prisma.devyPlayer.findMany({
    where,
    orderBy: { devyValue: 'desc' },
    take: opts?.limit || 100,
  })
}

export async function getStatusSummary(): Promise<Record<DraftStatus, number>> {
  const counts = await prisma.devyPlayer.groupBy({
    by: ['draftStatus'],
    _count: { id: true },
  })

  const summary: Record<string, number> = {
    college: 0, declared: 0, drafted: 0, nfl_active: 0, returning: 0,
  }
  for (const row of counts) {
    summary[row.draftStatus] = row._count.id
  }
  return summary as Record<DraftStatus, number>
}

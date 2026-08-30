import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import {
  getCFBPlayerStats, getCFBTeamRoster,
  getCFBDraftPicksResult, getCFBTeamRosterResult, CfbdUnavailableError,
  getCFBRecruits, getCFBTransferPortal, getCFBReturningProduction,
  getCFBPlayerUsage, getCFBPlayerPPA, getCFBSPRatings,
  getCFBPlayerWEPAPassing, getCFBPlayerWEPARushing,
  getCFBPassingPlayerSeason, getCFBPassingTeamSeason, getCFBPassingPlays,
  type CFBPlayer, type CFBPlayerStats, type CFBDraftPick,
  type CFBRecruit, type CFBTransferPortalEntry, type CFBReturningProduction,
  type CFBPlayerUsage, type CFBPlayerPPA, type CFBTeamSPRating, type CFBPlayerWEPA,
  type CFBPassingProfile, type CFBTeamPassingSummary,
  type CFBPassingPlay, type CFBPassLocationGrid, type CFBPassLocationSplit,
} from '@/lib/cfb-player-data'
import { rotateForFairness } from '@/lib/cron/runBudget'
import { describeCfbdFailure } from '@/lib/cfbd-fetch'
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

export const TOP_CFB_TEAMS = [
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

export async function ingestCFBDRosters(
  season?: number,
  options?: { teams?: readonly string[]; shouldStop?: () => boolean },
): Promise<{ ingested: number; rosterYear: number; teamsProcessed: string[]; errors: string[] }> {
  const currentYear = new Date().getFullYear()
  let year = season || currentYear
  let ingested = 0
  const errors: string[] = []
  const teamsProcessed: string[] = []

  /*
   * Season probe. Uses the RESULT variant on purpose: `getCFBTeamRoster` answers
   * `[]` for a quota wall exactly as it does for "this season is not published
   * yet", so the `[]`-returning wrapper would silently drop us to last season on
   * a provider outage — and then upsert a full roster under the wrong year.
   * A refusal must abort the phase, not be read as a season signal.
   */
  const probe = await getCFBTeamRosterResult('Alabama', year)
  if (!probe.ok) {
    throw new CfbdUnavailableError(probe.failure.status ?? 0)
  }
  if (probe.data.length === 0 && year === currentYear) {
    year = currentYear - 1
    console.log(`[DevySync] Current year roster not available, falling back to ${year}`)
  }

  for (const team of options?.teams ?? TOP_CFB_TEAMS) {
    if (options?.shouldStop?.()) break
    try {
      // Result variant again: an empty roster and a refused request must not
      // both arrive as `[]`, or the run reports `upserted: 0, errors: 0` for a
      // provider that answered nothing.
      const rosterRes = await getCFBTeamRosterResult(team, year)
      if (!rosterRes.ok) {
        throw new CfbdUnavailableError(rosterRes.failure.status ?? 0)
      }
      const fantasyPlayers = rosterRes.data.filter(p => FANTASY_POSITIONS.has(p.position))

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

      teamsProcessed.push(team)
      await new Promise(r => setTimeout(r, 200))
    } catch (err: any) {
      errors.push(`Team ${team} fetch failed: ${err.message?.slice(0, 100)}`)
    }
  }

  return { ingested, rosterYear: year, teamsProcessed, errors }
}

/**
 * Stat ingestion for the DevyPlayer pool.
 *
 * The `teams` / `shouldStop` options mirror ingestCFBDRosters and exist for the
 * same reason: this now runs inside the import-players cron's shared 240s
 * budget, which means it must cover a ROTATING SLICE and stop cleanly between
 * teams rather than a fixed `TOP_CFB_TEAMS.slice(0, 25)` that could neither
 * finish nor reach schools 26-49. That hardcoded 25 was also why the back half
 * of TOP_CFB_TEAMS had never had a stat line written for it by any caller.
 *
 * `teamsProcessed` is returned (rosters already did) so the caller can record
 * real coverage instead of assuming the slice it asked for is the slice that ran.
 */
export async function ingestCFBDStats(
  season?: number,
  options?: { teams?: readonly string[]; shouldStop?: () => boolean },
): Promise<{ updated: number; teamsProcessed: string[]; errors: string[] }> {
  const year = season || new Date().getFullYear() - 1
  let updated = 0
  const errors: string[] = []
  const teamsProcessed: string[] = []

  for (const team of options?.teams ?? TOP_CFB_TEAMS.slice(0, 25)) {
    if (options?.shouldStop?.()) break
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

      teamsProcessed.push(team)
      await new Promise(r => setTimeout(r, 200))
    } catch (err: any) {
      errors.push(`Team ${team} stats failed: ${err.message?.slice(0, 100)}`)
    }
  }

  return { updated, teamsProcessed, errors }
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
  let draftYearsLoaded = 0
  for (const draftYear of draftYearsToCheck) {
    const res = await getCFBDraftPicksResult(draftYear)
    if (!res.ok) {
      result.errors.push(`Draft picks ${draftYear}: ${describeCfbdFailure(res.failure)}`)
      continue
    }
    draftYearsLoaded++
    for (const pick of res.data) {
      if (!pick.playerName) continue
      const normalizedPickName = normalizeName(pick.playerName)
      if (normalizedPickName.length < 3) continue
      const existing = draftPicksByName.get(normalizedPickName) || []
      existing.push(pick)
      draftPicksByName.set(normalizedPickName, existing)
    }
    console.log(`[ClassifyStatus] CFBD draft ${draftYear}: ${res.data.length} picks loaded`)
    await new Promise(r => setTimeout(r, 300))
  }

  console.log('[ClassifyStatus] Building current roster index from CFBD...')
  const currentRosterSet = new Set<string>()
  let teamsLoaded = 0
  for (const team of TOP_CFB_TEAMS) {
    const res = await getCFBTeamRosterResult(team, rosterYear)
    if (!res.ok) {
      result.errors.push(`Roster ${team}: ${describeCfbdFailure(res.failure)}`)
      continue
    }
    teamsLoaded++
    for (const p of res.data) {
      if (!FANTASY_POSITIONS.has(p.position)) continue
      const key = `${normalizeName(p.fullName)}|${p.position}|${team}`
      currentRosterSet.add(key)
    }
    await new Promise(r => setTimeout(r, 100))
  }
  console.log(`[ClassifyStatus] Current roster index: ${currentRosterSet.size} players on ${rosterYear} rosters`)

  /*
   * ⚠ FAIL CLOSED. Every branch below infers status from ABSENCE — not in the
   * draft-pick index means not drafted, not in the roster index means gone from
   * college — and then WRITES `graduatedToNFL` for all ~1,700 players. If those
   * indexes are empty because CFBD refused the request rather than because the
   * players are genuinely not in them, the write turns an outage into a fact
   * about every player on the board.
   *
   * Not hypothetical: verified 2026-08-25 the key returns HTTP 429
   * `{"message":"Monthly call quota exceeded."}`, and before lib/cfbd-fetch.ts
   * every one of those became an empty array indistinguishable from a real
   * result. It is masked right now only because the table holds forward-looking
   * cohorts, so nobody is graduatedToNFL=true yet to be wiped. Backfilling
   * historical draft classes removes that accident.
   *
   * Refusing to classify beats classifying from nothing: the previous run's
   * values stand, and the errors say why.
   */
  if (draftYearsLoaded === 0) {
    result.errors.push(
      'ABORTED before writing: no draft-pick year loaded, so "not drafted" could not be told apart from "could not ask". Existing classifications left untouched.',
    )
    return result
  }
  if (teamsLoaded === 0) {
    result.errors.push(
      'ABORTED before writing: no team roster loaded, so "not on a current roster" would have been a fact about the network rather than the player. Existing classifications left untouched.',
    )
    return result
  }

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
// CFBD v2: Passing Detail Ingestion — air yards, ADOT, location, YAC
// ──────────────────────────────────────────────────────────────────

/**
 * Write the passing profile onto the devy pool.
 *
 * SHAPE COPIED FROM `ingestCFBDUsageAndPPA` DELIBERATELY: two season-wide
 * fetches (one player, one team), then a write loop over TOP_CFB_TEAMS. The
 * provider cost is 2 calls; the time cost is the DB loop. That is why this
 * belongs on the cadence-gated intel schedule and not on the per-team stat
 * slice.
 *
 * ⚠ PASS THE SEASON IN. The bare `getFullYear()` fallback is only a floor: in
 * February it names a season that has not kicked off, and CFBD answers with an
 * empty set. That is harmless here — an empty response writes nothing and
 * stamps no season — but it burns a cadence slot on a question with no answer.
 * The scheduler passes `defaultStatSeason()`, which holds the completed season
 * until September and then follows the live one. This does not import it
 * directly: `devyStatsRefresh` already imports this module, and reaching back
 * would close the cycle.
 *
 * ⚠ NULLS ARE WRITTEN, ZEROS ARE NOT. A passer the feed has no air-yard data for
 * gets null, never 0 — the distinction the migration exists for. And a field is
 * only written when the feed supplied it, so a partially-covered response cannot
 * blank a column that a better-covered earlier run had filled.
 */
export async function ingestCFBDPassingProfile(season?: number): Promise<{ updated: number; errors: string[] }> {
  const year = season || new Date().getFullYear()
  let updated = 0
  const errors: string[] = []

  try {
    const [passers, teamUnits] = await Promise.all([
      getCFBPassingPlayerSeason(year),
      getCFBPassingTeamSeason(year),
    ])

    const teamSet = new Set(TOP_CFB_TEAMS)

    const passersByTeam = new Map<string, Map<string, CFBPassingProfile>>()
    for (const p of passers) {
      if (!p.playerName || !p.team || !teamSet.has(p.team)) continue
      if (!passersByTeam.has(p.team)) passersByTeam.set(p.team, new Map())
      passersByTeam.get(p.team)!.set(normalizeName(p.playerName), p)
    }

    // OFFENSE ONLY. The defensive row is how deep opponents threw AGAINST this
    // school; writing it into teamPassAdot would make a good pass defence read
    // as a vertical offence, which is the exact inversion the adapter's
    // `unit` discriminator exists to prevent.
    const teamOffense = new Map<string, CFBTeamPassingSummary>()
    for (const t of teamUnits) {
      if (t.unit !== 'offense' || !t.team || !teamSet.has(t.team)) continue
      teamOffense.set(t.team, t)
    }

    for (const team of TOP_CFB_TEAMS) {
      const passerMap = passersByTeam.get(team) || new Map<string, CFBPassingProfile>()
      const offense = teamOffense.get(team)

      // School-wide context first: one updateMany for every eligible player at
      // the school, the same way ingestCFBDTeamContext writes SP+.
      if (offense) {
        const teamData: any = {}
        if (offense.adot != null) teamData.teamPassAdot = offense.adot
        // Prefer the vendor's own average: it is computed over the same
        // availability count it used for ADOT. Divide only as a fallback, and
        // only over yacCompletions — never over completions.
        const teamYac =
          offense.avgYardsAfterCatch ??
          (offense.yardsAfterCatch != null && offense.yacCompletions != null && offense.yacCompletions > 0
            ? offense.yardsAfterCatch / offense.yacCompletions
            : null)
        if (teamYac != null) teamData.teamPassYacPerComp = teamYac

        if (Object.keys(teamData).length > 0) {
          try {
            await prisma.devyPlayer.updateMany({
              where: { school: team, devyEligible: true },
              data: { ...teamData, lastSyncedAt: new Date() },
            })
          } catch (dbErr: any) {
            errors.push(`Team passing context failed for ${team}: ${dbErr.message?.slice(0, 80)}`)
          }
        }
      }

      for (const [name, p] of passerMap) {
        try {
          const existing = await prisma.devyPlayer.findFirst({
            where: { normalizedName: name, school: team },
          })
          if (!existing) continue

          const updateData: any = { lastSyncedAt: new Date() }

          if (p.attempts != null) updateData.passAttempts = p.attempts
          if (p.completions != null) updateData.passCompletions = p.completions
          if (p.airYards != null) updateData.airYards = p.airYards
          if (p.adot != null) updateData.adot = p.adot
          if (p.airYardsAttempts != null) updateData.airYardsAttempts = p.airYardsAttempts
          if (p.yardsAfterCatch != null) updateData.yardsAfterCatch = p.yardsAfterCatch
          if (p.yacCompletions != null) updateData.yacCompletions = p.yacCompletions

          // ⚠ NO LOCATION BRANCH HERE ANY MORE, AND THAT IS THE FIX. This
          // read `p.locations` off the SEASON endpoint, which carries no
          // location key at all — see the return type of
          // `getCFBPassingPlayerSeason`. The condition was false on every row
          // ever written. `passLocations` is filled by
          // `ingestCFBDPassLocations` from `/passing/plays`, the only grain
          // that has the data.

          // Only stamp the season once something from this season actually
          // landed. Stamping it on an empty response would date a profile that
          // is still last season's.
          if (Object.keys(updateData).length > 1) {
            updateData.passingProfileSeason = p.season || year
            await prisma.devyPlayer.update({ where: { id: existing.id }, data: updateData })
            updated++
          }
        } catch (dbErr: any) {
          errors.push(`Passing profile update failed for ${name}: ${dbErr.message?.slice(0, 80)}`)
        }
      }
    }
  } catch (err: any) {
    // CfbdUnavailableError must reach the scheduler intact: it is the difference
    // between "no passer at these schools threw a measured ball" and "the key is
    // over quota". The intel sweep catches it by type and reports a labeled
    // skip; swallowing it here into an error string would report a clean zero.
    if (err instanceof CfbdUnavailableError) throw err
    errors.push(`Passing profile bulk fetch failed: ${err.message?.slice(0, 100)}`)
  }

  return { updated, errors }
}

// ──────────────────────────────────────────────────────────────────
// CFBD pass locations — the one part of the passing feed that is play grain
// ──────────────────────────────────────────────────────────────────
//
// 🛑 THE COLUMN EXISTED AND NOTHING COULD EVER FILL IT. `DevyPlayer.passLocations`
// shipped 2026-08-30 with a read layer, a schema comment, and a phase whose own
// docstring claims it covers "pass location" — but the only writer read
// `p.locations` off `/passing/players/season`, and that endpoint carries no
// location key at all. `getCFBPassingPlayerSeason` says so in its own return
// type: "ALWAYS `{}` FOR THE SEASON AND TEAM ENDPOINTS". So `hasLocations` was
// provably false on every row, forever. Not a gap in coverage — a branch that
// could not be taken.
//
// Short/deep × left/middle/right is per-attempt and lives ONLY on
// `/passing/plays`, which the adapter deliberately does not ingest because play
// grain is six figures of rows a season and there is no table at that grain.
// Both of those things stay true. What changes here is that the plays are FOLDED
// into the season-grain grid the column was designed to hold, so the cost is one
// request per school rather than a row per throw, and nothing is stored at a
// grain the devy board cannot read.
//
// ⚠ EVERY CELL CARRIES ITS OWN DENOMINATOR, and that is not ceremony. This is the
// same feature that shipped an ADOT with a NULL `airYardsAttempts` — an average
// over an unrecorded number of throws, which reads as data and is not. A location
// grid fails identically: "5 deep lefts" means nothing without knowing whether it
// is out of 40 measured attempts or 400, and CFBD says location is present only
// "when provided in the play data". So the grid records how many attempts were
// SEEN and how many could actually be PLACED, and each measured quantity is
// stored beside the count of plays that carried it. A cell whose `yardsMeasured`
// is 0 reports `yards: null`, never 0.

/** One cell of the grid. Counts, each beside the plays that supplied it. */
export interface DevyPassLocationCell {
  /** Plays that landed in this cell. Always known — the play exists. */
  attempts: number
  completions: number | null
  /** Denominator for `completions` — plays whose completion flag was present. */
  completionsMeasured: number
  yards: number | null
  /** Denominator for `yards` — plays that carried a numeric yardage. */
  yardsMeasured: number
  touchdowns: number | null
  touchdownsMeasured: number
  interceptions: number | null
  interceptionsMeasured: number
}

export type DevyPassLocationGrid = Partial<
  Record<'short' | 'deep', Partial<Record<'left' | 'middle' | 'right', DevyPassLocationCell>>>
>

/** The JSON written to `DevyPlayer.passLocations`. */
export interface DevyPassLocations {
  season: number
  /** Attempts seen for this passer on `/passing/plays`. The grid's denominator. */
  attempts: number
  /** Attempts carrying BOTH a depth and a direction, so placeable in the grid. */
  located: number
  grid: DevyPassLocationGrid
}

type CellAccumulator = {
  attempts: number
  completions: number
  completionsMeasured: number
  yards: number
  yardsMeasured: number
  touchdowns: number
  touchdownsMeasured: number
  interceptions: number
  interceptionsMeasured: number
}

function newCell(): CellAccumulator {
  return {
    attempts: 0,
    completions: 0,
    completionsMeasured: 0,
    yards: 0,
    yardsMeasured: 0,
    touchdowns: 0,
    touchdownsMeasured: 0,
    interceptions: 0,
    interceptionsMeasured: 0,
  }
}

function sealCell(c: CellAccumulator): DevyPassLocationCell {
  return {
    attempts: c.attempts,
    // Null, never 0, when nothing measured it — the distinction the whole
    // passing migration exists for.
    completions: c.completionsMeasured > 0 ? c.completions : null,
    completionsMeasured: c.completionsMeasured,
    yards: c.yardsMeasured > 0 ? c.yards : null,
    yardsMeasured: c.yardsMeasured,
    touchdowns: c.touchdownsMeasured > 0 ? c.touchdowns : null,
    touchdownsMeasured: c.touchdownsMeasured,
    interceptions: c.interceptionsMeasured > 0 ? c.interceptions : null,
    interceptionsMeasured: c.interceptionsMeasured,
  }
}

/**
 * Fold one school's attempts into a per-passer location grid.
 *
 * Keyed by normalized passer name so it joins to `DevyPlayer.normalizedName` the
 * same way every other CFBD ingest in this file does.
 *
 * ⚠ A PLAY WITH NO LOCATION STILL COUNTS. It raises `attempts` and not `located`,
 * which is precisely how a reader tells a genuinely short-and-left passer from
 * one whose plays simply were not tagged. Dropping unlocated plays here would
 * make every passer's grid look complete.
 */
export function aggregatePassLocations(
  plays: CFBPassingPlay[],
  team: string,
  fallbackSeason: number,
): Map<string, DevyPassLocations> {
  const byPasser = new Map<
    string,
    { season: number; attempts: number; located: number; grid: Map<string, CellAccumulator> }
  >()

  for (const play of plays) {
    // The team filter is a query parameter, not a guarantee: `/passing/plays`
    // describes both sides of a game, so an unguarded fold would credit the
    // OPPOSING quarterback's throws to this school.
    if (play.offense !== team) continue
    if (!play.passer) continue

    const key = normalizeName(play.passer)
    if (!key) continue

    let entry = byPasser.get(key)
    if (!entry) {
      entry = { season: play.season || fallbackSeason, attempts: 0, located: 0, grid: new Map() }
      byPasser.set(key, entry)
    }

    entry.attempts++
    if (!play.depth || !play.direction) continue
    entry.located++

    const cellKey = `${play.depth}|${play.direction}`
    let cell = entry.grid.get(cellKey)
    if (!cell) {
      cell = newCell()
      entry.grid.set(cellKey, cell)
    }

    cell.attempts++
    if (typeof play.completion === 'boolean') {
      cell.completionsMeasured++
      if (play.completion) cell.completions++
    }
    // `Number.isFinite` and not truthiness: a 0-yard completion is a real
    // measurement, and a throw behind the line is negative.
    if (typeof play.yards === 'number' && Number.isFinite(play.yards)) {
      cell.yardsMeasured++
      cell.yards += play.yards
    }
    if (typeof play.touchdown === 'boolean') {
      cell.touchdownsMeasured++
      if (play.touchdown) cell.touchdowns++
    }
    if (typeof play.interception === 'boolean') {
      cell.interceptionsMeasured++
      if (play.interception) cell.interceptions++
    }
  }

  const out = new Map<string, DevyPassLocations>()
  for (const [name, entry] of byPasser) {
    const grid: DevyPassLocationGrid = {}
    for (const [cellKey, cell] of entry.grid) {
      const [depth, dir] = cellKey.split('|') as ['short' | 'deep', 'left' | 'middle' | 'right']
      grid[depth] = { ...(grid[depth] ?? {}), [dir]: sealCell(cell) }
    }
    out.set(name, { season: entry.season, attempts: entry.attempts, located: entry.located, grid })
  }
  return out
}

/*
 * ⚠ BOUNDED AND ROTATED, BECAUSE THIS IS THE ONLY PER-TEAM FETCH IN THE INTEL
 * SWEEP. Every other feed in `devyIntelRefresh` pulls the season in one or two
 * calls and then loops the 50 schools only to WRITE, which is why that file's
 * header says "there is nothing to slice". This one genuinely does cost a
 * request per school, so a full pass is 50 against a 75,000/month allowance —
 * affordable monthly, but not inside a 240s tick shared with the importer.
 *
 * So the schools are split into fixed chunks and one chunk runs per day. Five
 * chunks at a 24h period is a full sweep every five days, against aggregates
 * that cannot move more than once a week.
 *
 * ⚠ CHUNKED RATHER THAN SLICING A ROTATED LIST, and the difference is not
 * cosmetic. `rotateForFairness` advances the offset by ONE unit per period, so
 * taking `.slice(0, 12)` of the rotated 50-school list would re-fetch eleven of
 * the same twelve schools every day and take fifty days to come around — the
 * exact starvation that function exists to prevent, reintroduced by the slice.
 * Rotating the CHUNKS moves all twelve.
 */
const PASS_LOCATION_TEAMS_PER_RUN = 12
const PASS_LOCATION_PERIOD_MS = 24 * 60 * 60 * 1000

function passLocationChunks(): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < TOP_CFB_TEAMS.length; i += PASS_LOCATION_TEAMS_PER_RUN) {
    chunks.push(TOP_CFB_TEAMS.slice(i, i + PASS_LOCATION_TEAMS_PER_RUN))
  }
  return chunks
}

/** The schools this tick is responsible for. Exported so a run can be explained. */
export function passLocationTeamsForRun(now: () => number = Date.now): string[] {
  const chunks = passLocationChunks()
  return rotateForFairness(chunks, PASS_LOCATION_PERIOD_MS, now)[0] ?? []
}

/**
 * Write `DevyPlayer.passLocations` for one rotating chunk of schools.
 *
 * ⚠ NULLS AND ABSENCES ARE PRESERVED, the same contract as the rest of the
 * passing ingest. A passer whose plays carried no location at all gets a grid of
 * `{}` beside a real `attempts` count — a measured "we looked and the feed had
 * none", not a gap — but a school the feed returned nothing for is skipped
 * entirely rather than written as empty, because a thin response must not blank
 * a grid an earlier, better-covered run had filled.
 */
export async function ingestCFBDPassLocations(
  season?: number,
  options?: { teams?: string[] },
): Promise<{ updated: number; errors: string[] }> {
  const year = season || new Date().getFullYear()
  const teams = options?.teams ?? passLocationTeamsForRun()
  let updated = 0
  const errors: string[] = []

  for (const team of teams) {
    let plays: CFBPassingPlay[]
    try {
      plays = await getCFBPassingPlays(year, { team })
    } catch (err: any) {
      // A quota wall must reach the scheduler intact rather than be counted as
      // "this school threw no measured balls".
      if (err instanceof CfbdUnavailableError) throw err
      errors.push(`Pass locations fetch failed for ${team}: ${err.message?.slice(0, 80)}`)
      continue
    }

    if (plays.length === 0) continue

    for (const [name, locations] of aggregatePassLocations(plays, team, year)) {
      try {
        const existing = await prisma.devyPlayer.findFirst({
          where: { normalizedName: name, school: team },
        })
        if (!existing) continue

        await prisma.devyPlayer.update({
          where: { id: existing.id },
          data: {
            passLocations: toPrismaJsonInput(locations),
            // Stamped for the same reason the season aggregates stamp it: the
            // DB-first read filters on a non-null season, so a grid written
            // without one would be invisible to every surface that reads it.
            passingProfileSeason: locations.season,
            lastSyncedAt: new Date(),
          },
        })
        updated++
      } catch (dbErr: any) {
        errors.push(`Pass location update failed for ${name}: ${dbErr.message?.slice(0, 80)}`)
      }
    }
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

/**
 * Candidate devy players, selected and ordered on SCOUTING EVIDENCE.
 *
 * ⚠ `minValue` FILTERS ON `devyValue`, WHICH IS NOT A VALUATION — it is
 * `calculateQuickDevyValue(position, classYear)`, a lookup with no
 * player-specific input, and it is 0 for 1,455 of 1,718 rows. Measured on prod
 * 2026-08-25, the board's `minValue: 3000` meant:
 *
 *     556 players WITH a real scouting projection were EXCLUDED
 *     256 players with a projection got through
 *       7 players with NO evidence at all were INCLUDED
 *
 * So the board could not see most of the class, and the eight of the top twelve
 * prospects sitting at devyValue 0 were never candidates at all. Prefer
 * `requireProjection` / `minProjection`, which select on the signal that has
 * evidence behind it. `minValue` is kept only so an existing caller does not
 * break, and should not be used in new code.
 */
export async function getEligibleDevyPlayers(opts?: {
  position?: string
  limit?: number
  /** @deprecated Filters on the fabricated devyValue. Use minProjection. */
  minValue?: number
  /** Floor on `draftProjectionScore`, the evidenced signal. */
  minProjection?: number
  /** Drop players with no scouting projection at all rather than ranking them. */
  requireProjection?: boolean
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
  if (opts?.minProjection != null) {
    where.draftProjectionScore = { gte: opts.minProjection }
  } else if (opts?.requireProjection) {
    where.draftProjectionScore = { not: null }
  }
  if (opts?.draftEligibleYear) where.draftEligibleYear = opts.draftEligibleYear
  if (opts?.draftStatus) where.draftStatus = opts.draftStatus

  return prisma.devyPlayer.findMany({
    where,
    /*
     * ⚠ NULLS LAST IS EXPLICIT. Postgres orders NULLS FIRST on DESC, so without
     * this every unscored player would head the board — the exact inversion this
     * change exists to remove.
     */
    orderBy: { draftProjectionScore: { sort: 'desc', nulls: 'last' } },
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

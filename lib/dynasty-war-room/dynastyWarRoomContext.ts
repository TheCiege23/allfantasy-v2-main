/**
 * DYNASTY AF WAR ROOM — canonical context builder.
 *
 * This is the ONLY file in the dynasty War Room that performs DB I/O. It assembles
 * a deterministic, serializable `DynastyWarRoomContext` from the NATIVE dynasty data
 * layer: legacy `Roster.playerData` (lineup_sections) for rosters/taxi/IR, `LeagueTeam`
 * for standings/ownership, `SportsPlayer.age` for age trajectory, dynasty ADP
 * (`AllFantasyAdpSnapshot` leagueType='dynasty') for long-term value, and the real
 * injury/news provider tables. It NEVER calls OpenAI and NEVER fabricates values,
 * ages, picks, injuries, or news.
 *
 * Dynasty horizon ≠ redraft: value is long-term asset value + AGE trajectory + (when
 * available) future pick capital — not weekly projections. Pick capital comes from
 * `dynastyPickCapital.ts`; when it cannot be read it is flagged 'missing', never invented.
 *
 * When a data source is empty it sets the matching `availability` flag and records a
 * human-readable `missingDataFlags` entry so engines and the AI layer degrade safely.
 *
 * See lib/dynasty-war-room/types.ts for the contract.
 */

import { prisma } from '@/lib/prisma'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { resolveLeagueAccess } from '@/lib/league-access'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'
import { pickAgreedAge, type AgeRow } from '@/lib/player-age'
import { fetchRedraftInjuryNews, injuryNameKey } from '@/lib/redraft-war-room/redraftInjuryNews'
import { dynastyValue } from './dynastyPlayerValue'
import { deriveCatalogStarterRequirements } from './dynastySportCatalog'
import { loadDynastyPickCapital, type DynastyPickCapital } from './dynastyPickCapital'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { identityNameKey } from '@/lib/redraft/rosterGameLogIdBridge'
import {
  fetchDynastyFreeAgentPool,
  fetchDynastyNhlProspectFreeAgents,
  fetchDynastyValueByKey,
  dynastyRosteredKeys,
} from './dynastyFreeAgentPool'
import type {
  DataState,
  DynastyDataAvailability,
  DynastyPlayerFact,
  DynastyRookieDraftWindow,
  DynastyRosterSettings,
  DynastyScoringSettings,
  DynastyTeamSummary,
  DynastyWarRoomContext,
} from './types'

export interface BuildDynastyWarRoomContextInput {
  leagueId: string
  userId: string | null | undefined
}

export type BuildDynastyWarRoomContextResult =
  | { ok: true; context: DynastyWarRoomContext }
  | { ok: false; status: 401 | 403 | 404; error: string }

const SUPERFLEX_RE = /super[_\s]?flex|sflex|2qb/i
const FLEX_RE = /flex|^util$|^super_util$/i

/** Map a normalized lineup section name to a War Room slotType. */
function sectionSlotType(section: 'starters' | 'bench' | 'ir' | 'taxi' | 'devy'): string {
  if (section === 'starters') return 'starter'
  if (section === 'ir') return 'ir'
  if (section === 'taxi') return 'taxi'
  if (section === 'devy') return 'taxi' // devy stash treated as a developmental (taxi-like) slot
  return 'bench'
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function resolveScoring(
  sport: string,
  settings: Record<string, unknown> | null | undefined,
  rosterFormatType: string,
  scoringPresetName: string,
): DynastyScoringSettings {
  const sc = (settings?.sportConfig as Record<string, unknown> | undefined) ?? {}
  const superflex =
    sc.enableSuperflex === true ||
    SUPERFLEX_RE.test(rosterFormatType) ||
    SUPERFLEX_RE.test(String(settings?.roster_format_type ?? ''))
  return {
    sport,
    scoringPreset: String(scoringPresetName || sc.scoringPreset || 'PPR').toUpperCase(),
    superflex,
    tePremium: sc.enableTEPremium === true,
  }
}

/**
 * Build the canonical dynasty War Room context. Enforces league membership.
 * Commissioners see league-wide rosters; members see all teams but only their own
 * roster is flagged `isUserTeam` for personalized recommendations.
 */
export async function buildDynastyWarRoomContext(
  input: BuildDynastyWarRoomContextInput,
): Promise<BuildDynastyWarRoomContextResult> {
  const { leagueId, userId } = input
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }

  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return { ok: false, status: 403, error: 'Forbidden' }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    // `platform` decides where pick capital is read from (see `dynastyPickCapital.ts`).
    // `leagueType` feeds the NHL prospect rule (`offersNhlProspectFreeAgency`, dynasty family).
    select: { sport: true, season: true, settings: true, isDynasty: true, leagueType: true, leagueVariant: true, platform: true },
  })
  if (!league) return { ok: false, status: 404, error: 'League not found' }

  const variant = String(league.leagueVariant ?? '').toLowerCase()
  const isDynasty =
    league.isDynasty === true || variant === 'devy_dynasty' || variant === 'merged_devy_c2c'
  if (!isDynasty) return { ok: false, status: 404, error: 'Not a dynasty league' }

  const settings = (league.settings as Record<string, unknown> | null) ?? null
  const sport = String(league.sport ?? 'NFL')
  const season = Number(league.season ?? new Date().getFullYear())

  // --- dynasty settings (scoring/taxi) — best-effort, never throws ---
  let rosterFormatType = String(settings?.roster_format_type ?? settings?.roster_format ?? '')
  let scoringPresetName = String(settings?.scoring_format_type ?? settings?.scoring_format ?? 'PPR')
  let taxiSlotsFromSettings = 0
  try {
    const { getEffectiveDynastySettings } = await import('@/lib/dynasty-core/DynastySettingsService')
    const dyn = await getEffectiveDynastySettings(leagueId)
    if (dyn) {
      rosterFormatType = dyn.rosterFormatType || rosterFormatType
      scoringPresetName = dyn.scoringPresetName || scoringPresetName
      taxiSlotsFromSettings = Number(dyn.taxiSlots ?? 0) || 0
    }
  } catch {
    // keep settings-derived defaults
  }
  const scoring = resolveScoring(sport, settings, rosterFormatType, scoringPresetName)

  // --- roster template → starter/bench/taxi/IR rules ---
  const roster: DynastyRosterSettings = {
    totalStarterSlots: 0,
    benchSlots: 0,
    taxiSlots: taxiSlotsFromSettings,
    irSlots: 0,
    requiredByPosition: {},
  }
  let rosterRulesState: DataState = 'available'
  try {
    const tmpl = await getEffectiveLeagueRosterTemplate(leagueId)
    let taxiFromTemplate = 0
    let flexCount = 0
    let superflexCount = 0
    for (const s of tmpl.template.slots) {
      const starter = s.starterCount ?? 0
      if (starter > 0) {
        roster.totalStarterSlots += starter
        const name = String(s.slotName ?? '')
        const isSuper = SUPERFLEX_RE.test(name)
        const isFlex = !isSuper && ((s as { isFlexibleSlot?: boolean }).isFlexibleSlot || FLEX_RE.test(name))
        if (isSuper) {
          superflexCount += starter
        } else if (isFlex) {
          flexCount += starter
        } else {
          // Dedicated positional slot: attribute to its single allowed position when unambiguous.
          const pos =
            (s.allowedPositions?.length ?? 0) === 1 ? s.allowedPositions[0].toUpperCase() : name.toUpperCase()
          roster.requiredByPosition[pos] = (roster.requiredByPosition[pos] ?? 0) + starter
        }
      }
      roster.benchSlots += s.benchCount ?? 0
      roster.irSlots += s.reserveCount ?? 0
      taxiFromTemplate += (s as { taxiCount?: number }).taxiCount ?? 0
    }
    // Distribute FLEX/SUPERFLEX across positions the way league-decision-context does,
    // so we never create a phantom "FLEX" positional need.
    if (flexCount > 0) {
      roster.requiredByPosition.RB = (roster.requiredByPosition.RB ?? 0) + Math.ceil(flexCount * 0.4)
      roster.requiredByPosition.WR = (roster.requiredByPosition.WR ?? 0) + Math.ceil(flexCount * 0.4)
      roster.requiredByPosition.TE = (roster.requiredByPosition.TE ?? 0) + Math.ceil(flexCount * 0.2)
    }
    if (superflexCount > 0) {
      roster.requiredByPosition.QB = (roster.requiredByPosition.QB ?? 0) + superflexCount
    }
    /*
     * 🛑 THE RB/WR/TE SPLIT ABOVE IS NFL'S. It used to run for every sport, so an NBA roster's two
     * UTIL slots became RB/WR/TE "needs" that flowed into trade targets and waiver adds. For
     * NBA/MLB/NHL the demand is rebuilt from the sport's own slot catalog (UTIL → the positions UTIL
     * accepts). NFL — and any sport without a catalog — keeps the result above unchanged.
     */
    const catalogRequired = deriveCatalogStarterRequirements(sport, tmpl.template.slots)
    if (catalogRequired) roster.requiredByPosition = catalogRequired
    if (taxiFromTemplate > 0) roster.taxiSlots = taxiFromTemplate
  } catch {
    rosterRulesState = 'missing'
  }

  // --- native rosters from legacy Roster.playerData + LeagueTeam standings ---
  type RosterRow = { id: string; platformUserId: string; playerData: unknown; faabRemaining: number | null }
  const rosterRows = (await prisma.roster
    .findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true, playerData: true, faabRemaining: true },
    })
    .catch(() => [])) as RosterRow[]

  type TeamRow = {
    id: string
    externalId: string
    platformUserId: string | null
    claimedByUserId: string | null
    ownerName: string
    teamName: string
    wins: number
    losses: number
    ties: number
    pointsFor: number
    currentRank: number | null
  }
  const teamRows = (await prisma.leagueTeam
    .findMany({
      where: { leagueId },
      select: {
        // The roster↔team join that imported pick capital needs.
        id: true,
        externalId: true,
        platformUserId: true,
        claimedByUserId: true,
        ownerName: true,
        teamName: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        currentRank: true,
      },
    })
    .catch(() => [])) as TeamRow[]
  const teamByUser = new Map<string, TeamRow>()
  for (const t of teamRows) {
    if (t.platformUserId) teamByUser.set(t.platformUserId, t)
    if (t.claimedByUserId && !teamByUser.has(t.claimedByUserId)) teamByUser.set(t.claimedByUserId, t)
  }

  // Flatten every roster's lineup sections into raw player rows (carrying slotType).
  type RawPlayer = {
    rosterId: string
    ownerId: string
    playerId: string
    playerName: string
    position: string
    team: string | null
    slotType: string
  }
  const rawPlayers: RawPlayer[] = []
  for (const r of rosterRows) {
    const sections = getNormalizedLineupSections(r.playerData)
    for (const sec of ['starters', 'bench', 'ir', 'taxi', 'devy'] as const) {
      for (const item of sections[sec]) {
        const playerId = pickStr(item, ['id', 'playerId', 'player_id'])
        if (!playerId) continue
        const playerName = pickStr(item, ['name', 'full_name', 'fullName', 'displayName']) ?? playerId
        const position = (pickStr(item, ['position', 'pos']) ?? 'UNK').toUpperCase()
        const team = pickStr(item, ['team', 'nflTeam', 'proTeam', 'teamAbbr'])
        rawPlayers.push({
          rosterId: r.id,
          ownerId: r.platformUserId,
          playerId,
          playerName,
          position,
          team: team ? team.toUpperCase() : null,
          slotType: sectionSlotType(sec),
        })
      }
    }
  }

  // --- value (dynasty ADP), ages (SportsPlayer), injuries/news (provider tables) ---
  const dynastyAdpByKey = await fetchDynastyValueByKey(sport, season)

  /*
   * 🛑 AGES ARE BOUND TO ONE PLAYER, NOT TO A NAME (2026-10-11). This used to keep the FIRST row
   * per lowercased name, and `SportsPlayer` holds namesakes with different ages — "Justin
   * Jefferson" is 27 (WR, MIN) and 23 (LB, CLE) — so the receiver could read as a 23-year-old and
   * the whole age trajectory with him. `pickAgreedAge` binds by Sleeper id when the league is a
   * Sleeper league (roster ids ARE Sleeper ids there and nowhere else), else by name within the
   * player's position group, and refuses rows that disagree. See lib/player-age.ts.
   */
  const sportVar = [sport, sport.toUpperCase(), sport.toLowerCase()]
  const rosterIdsAreSleeperIds = String(league.platform ?? '').toLowerCase() === 'sleeper'
  const loadAgeRows = async (players: Array<{ playerName: string; playerId?: string }>): Promise<AgeRow[]> => {
    const names = Array.from(new Set(players.map((p) => p.playerName).filter((n) => n && n.length > 1)))
    const ids = rosterIdsAreSleeperIds
      ? Array.from(new Set(players.map((p) => p.playerId).filter((id): id is string => !!id)))
      : []
    if (names.length === 0 && ids.length === 0) return []
    return (await prisma.sportsPlayer
      .findMany({
        where: {
          sport: { in: sportVar },
          age: { not: null },
          OR: [{ name: { in: names } }, ...(ids.length > 0 ? [{ sleeperId: { in: ids } }] : [])],
        },
        select: { name: true, age: true, position: true, sleeperId: true },
      })
      .catch(() => [])) as AgeRow[]
  }
  const rosterAgeRows = await loadAgeRows(rawPlayers)

  const injuryNews = await fetchRedraftInjuryNews(sport)

  function toPlayerFact(p: RawPlayer): DynastyPlayerFact {
    const key = buildPlayerKey(p.playerName, p.position)
    const adp = dynastyAdpByKey.get(key) ?? null
    const age = pickAgreedAge(rosterAgeRows, {
      name: p.playerName,
      position: p.position,
      sleeperId: rosterIdsAreSleeperIds ? p.playerId : null,
    })
    const injuryStatus = injuryNews.injuryByName.get(injuryNameKey(p.playerName))?.status ?? null
    const base: DynastyPlayerFact = {
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      team: p.team,
      slotType: p.slotType,
      isStarterSlot: p.slotType === 'starter',
      age,
      dynastyValue: null,
      adp,
      injuryStatus,
      weekProjection: null,
      hasNoValueSignal: adp == null,
    }
    const { value, source } = dynastyValue(base, sport)
    base.dynastyValue = source === 'none' ? null : value
    return base
  }

  // Group raw players by roster.
  const byRoster = new Map<string, RawPlayer[]>()
  for (const p of rawPlayers) {
    const arr = byRoster.get(p.rosterId) ?? []
    arr.push(p)
    byRoster.set(p.rosterId, arr)
  }

  // --- future draft pick capital, keyed by Roster.id (see dynastyPickCapital.ts) ---
  const rawStatus = settings?.status
  const providerStatus = typeof rawStatus === 'string' ? rawStatus : null
  const pickCapital = await loadDynastyPickCapital({
    leagueId,
    platform: league.platform,
    leagueSeason: season,
    providerStatus,
    rosters: rosterRows,
    teams: teamRows.map((t) => ({
      id: t.id,
      externalId: String(t.externalId ?? ''),
      platformUserId: t.platformUserId,
      claimedByUserId: t.claimedByUserId,
      teamName: t.teamName ?? null,
    })),
  }).catch((): DynastyPickCapital => ({ picksByRosterId: new Map(), state: 'missing', note: null }))

  // --- rookie draft windows (real, from rookie_draft_windows) ---
  type WindowRow = {
    season: number
    status: string
    draftOrderMethod: string
    scheduledDraftDate: Date | null
  }
  const windowRows = (await prisma.rookieDraftWindow
    .findMany({
      where: { leagueId },
      select: { season: true, status: true, draftOrderMethod: true, scheduledDraftDate: true },
      orderBy: { season: 'asc' },
    })
    .catch(() => [] as WindowRow[])) as WindowRow[]
  const rookieDraftWindows: DynastyRookieDraftWindow[] = windowRows.map((w) => ({
    season: w.season,
    status: w.status,
    draftOrderMethod: w.draftOrderMethod,
    scheduledDraftDate: w.scheduledDraftDate ? w.scheduledDraftDate.toISOString() : null,
  }))

  const teams: DynastyTeamSummary[] = rosterRows.map((r) => {
    const team = teamByUser.get(r.platformUserId) ?? null
    return {
      rosterId: r.id,
      ownerId: r.platformUserId,
      // An orphan's key is a placeholder, not a name (imported orphans used to be keyed '').
      ownerName: team?.ownerName ?? (isOrphanPlatformUserId(r.platformUserId) ? '' : r.platformUserId),
      teamName: team?.teamName ?? null,
      wins: team?.wins ?? 0,
      losses: team?.losses ?? 0,
      ties: team?.ties ?? 0,
      pointsFor: team?.pointsFor ?? 0,
      playoffSeed: team?.currentRank ?? null,
      isUserTeam: r.platformUserId === userId,
      players: (byRoster.get(r.id) ?? []).map(toPlayerFact),
      // Keyed by the roster that holds each pick now, in Roster.id space for every platform.
      picks: pickCapital.picksByRosterId.get(r.id) ?? [],
    }
  })

  const userRosterId = teams.find((t) => t.isUserTeam)?.rosterId ?? null

  // --- free-agent pool (dynasty ADP minus rostered, sport-isolated) ---
  const allRosterPlayers = teams.flatMap((t) => t.players)
  const rosteredKeys = dynastyRosteredKeys(
    allRosterPlayers.map((p) => ({ playerName: p.playerName, position: p.position })),
  )
  const freeAgentRows = await fetchDynastyFreeAgentPool({
    sport,
    season,
    rosteredKeys,
    scoringFormat: scoring.scoringPreset.toLowerCase(),
    limit: 60,
  })
  /*
   * ⚠ FREE AGENTS GET THEIR OWN AGE ROWS. The old map was built from ROSTERED names only, so a
   * free agent had an age only when a rostered player shared his name — i.e. only in the namesake
   * case, and then it was the other man's age.
   */
  const freeAgentAgeRows = await loadAgeRows(freeAgentRows.map((fa) => ({ playerName: fa.playerName })))
  const freeAgents: DynastyPlayerFact[] = freeAgentRows.map((fa) => {
    const age = pickAgreedAge(freeAgentAgeRows, { name: fa.playerName, position: fa.position })
    return {
      playerId: fa.playerKey,
      playerName: fa.playerName,
      position: fa.position,
      team: null,
      slotType: 'free_agent',
      isStarterSlot: false,
      age,
      dynastyValue: dynastyValue({ adp: fa.adp } as DynastyPlayerFact, sport).value,
      adp: fa.adp,
      injuryStatus: injuryNews.injuryByName.get(injuryNameKey(fa.playerName))?.status ?? null,
      weekProjection: null,
      hasNoValueSignal: false,
    }
  })

  /*
   * NHL DYNASTY ONLY: free Fantrax prospects go AFTER every ADP-ranked free agent, as #3063 lists
   * them on the league's own free-agent screen. They carry no value or ADP, so the waiver engine and
   * the prompt never rank or advise them. Every other sport and league type gets null here, and so
   * does an unreadable stored universe: the pool is then exactly the ADP pool above.
   */
  const rosteredIds = new Set<string>(rawPlayers.map((p) => p.playerId))
  for (const r of rosterRows) for (const id of getRosterPlayerIds(r.playerData)) rosteredIds.add(String(id))
  const poolNames = new Set<string>()
  for (const fa of freeAgentRows) {
    const k = identityNameKey(fa.playerName)
    if (k) poolNames.add(k)
  }
  const prospectFreeAgents = await fetchDynastyNhlProspectFreeAgents(prisma as never, {
    league: { sport, isDynasty: league.isDynasty, leagueType: league.leagueType },
    rosteredIds,
    poolNames,
  })
  if (prospectFreeAgents) freeAgents.push(...prospectFreeAgents.prospects)

  // --- availability contract ---
  const valuesAvailable = dynastyAdpByKey.size > 0
  const agesAvailable = allRosterPlayers.some((p) => p.age != null) || freeAgents.some((p) => p.age != null)
  const standingsAvailable = teamRows.some(
    (t) => (t.wins ?? 0) + (t.losses ?? 0) + (t.ties ?? 0) > 0 || (t.pointsFor ?? 0) > 0,
  )
  /*
   * futurePicks: 'missing' when the table cannot be read; 'available' only when at least one pick
   * reached a team; 'partial' when an imported league's list can hold only its traded picks;
   * otherwise 'available_empty'.
   *
   * 🛑 THIS USED TO BE `pickRows.length > 0`, which said 'available' for all 103 imported dynasty
   * leagues on staging while every team's pick list was empty — rows existed, none were attached.
   */
  const futurePicksState: DataState = pickCapital.state
  const availability: DynastyDataAvailability = {
    scoringRules: 'available',
    rosterRules: rosterRulesState,
    standings: standingsAvailable ? 'available' : 'missing',
    rosters: rosterRows.length > 0 ? 'available' : 'missing',
    playerValues: valuesAvailable ? 'available' : 'missing',
    playerAges: agesAvailable ? 'available' : 'missing',
    futurePicks: futurePicksState,
    injuries:
      injuryNews.injuryByName.size > 0 || allRosterPlayers.some((p) => p.injuryStatus)
        ? 'available'
        : 'missing',
    news: injuryNews.newsCount > 0 ? 'available' : 'missing',
    projections: 'missing', // dynasty horizon: weekly projections not part of native context
    // The RANKED pool: unranked prospects never make waiver adds "available" on their own.
    freeAgentPool: freeAgentRows.length > 0 ? 'available' : 'missing',
  }

  const missingDataFlags: string[] = []
  if (availability.rosterRules === 'missing')
    missingDataFlags.push('Roster template could not be resolved — starter/taxi/IR rules unavailable.')
  if (availability.rosters === 'missing')
    missingDataFlags.push('No native rosters found for this league.')
  if (availability.playerValues === 'missing')
    missingDataFlags.push('No dynasty player values for this sport/season — value-based calls degrade to age/roster fit.')
  if (availability.playerAges === 'missing')
    missingDataFlags.push('No player ages available — age-trajectory signals are limited.')
  if (availability.futurePicks === 'missing')
    missingDataFlags.push('Future pick tracking is not enabled for this league yet — pick capital is not modeled.')
  else if (availability.futurePicks === 'available_empty')
    missingDataFlags.push('Future pick tracking is enabled, but no picks are recorded for this league yet.')
  if (pickCapital.note) missingDataFlags.push(pickCapital.note)
  if (availability.standings === 'missing')
    missingDataFlags.push('No standings/records yet — contention-window read relies on roster value only.')
  if (availability.injuries === 'missing') missingDataFlags.push('No injury data available.')
  if (availability.freeAgentPool === 'missing')
    missingDataFlags.push('Free-agent pool unavailable — specific add targets cannot be listed.')

  const hasValueSignal = valuesAvailable || agesAvailable

  const context: DynastyWarRoomContext = {
    leagueId,
    leagueType: 'dynasty',
    sport,
    season,
    scoring,
    roster,
    userRosterId,
    isCommissioner: access.isCommissioner,
    teams,
    freeAgents,
    ...(prospectFreeAgents ? { nhlProspectFreeAgents: prospectFreeAgents.meta } : {}),
    rookieDraftWindows,
    availability,
    freshness: {
      generatedAt: new Date().toISOString(),
      valuesAsOf: null,
      injuriesAsOf: injuryNews.injuriesAsOf ? injuryNews.injuriesAsOf.toISOString() : null,
    },
    missingDataFlags,
    featureAvailability: {
      teamDirection: hasValueSignal && availability.rosters === 'available',
      rosterNeeds: availability.rosterRules === 'available' && availability.rosters === 'available',
      tradeAnalyze: availability.rosters === 'available',
      tradeFind: hasValueSignal && availability.rosters === 'available',
      buySellHold: hasValueSignal && availability.rosters === 'available',
      waivers: availability.freeAgentPool === 'available',
      lineup: availability.rosterRules === 'available' && availability.rosters === 'available',
      // A partial list still names real picks; the pick engine withholds its total.
      pickValue: availability.futurePicks === 'available' || availability.futurePicks === 'partial',
    },
  }

  return { ok: true, context }
}

/**
 * NFL/NCAAF league AI grounding packet.
 *
 * Follows the same pattern as worldCupChimmyContext / chimmyGroundingPacket but
 * grounded in fantasy league data: settings, managers, rosters, draft status,
 * player pool, ADP, projections, injuries, and evidence/freshness tracking.
 *
 * DESIGN:
 *   - null  = "not loaded" — AI MUST NOT speculate, must cite missingData
 *   - []    = "loaded but empty" — AI may say "no data found"
 *   - All numbers come from DB; none are invented by AI
 *   - safeAnswerRules enforced in every AI system prompt
 */
import "server-only"
import { prisma } from "@/lib/prisma"
import { loadFantasyDataEvidence } from "@/lib/fantasy-data/fantasyDataEvidence"
import { computeFantasyFreshness } from "@/lib/fantasy-data/fantasyFreshness"
import { loadFantasyProviderHealth } from "@/lib/fantasy-data/providerHealth"
import type { FantasyDataEvidenceSnapshot } from "@/lib/fantasy-data/fantasyDataEvidence"
import type { FantasyFreshnessReport } from "@/lib/fantasy-data/fantasyFreshness"
import type { FantasyProviderHealthReport } from "@/lib/fantasy-data/providerHealth"
import { listInjuryFacts } from "@/lib/injuries/injuryReadPort"

// ─── League grounding sub-types ───────────────────────────────────────────────

export type LeagueGroundingSettings = {
  sport: string
  leagueType: string
  scoringPreset: string | null
  draftType: string | null
  numTeams: number
  isSuperflex: boolean
  isPPR: boolean
  isHalfPPR: boolean
  isStandard: boolean
  isIDP: boolean
  isBestBall: boolean
  isDynasty: boolean
  isKeeper: boolean
  playoffTeams: number | null
  playoffWeekStart: number | null
  rosterSlots: number | null
  benchSlots: number | null
  irSlots: number | null
  taxiSlots: number | null
  waiverType: string | null
  faabBudget: number | null
  tradeDeadline: number | null
  season: number | null
}

export type LeagueGroundingManager = {
  userId: string
  displayName: string
  teamName: string | null
  isCommissioner: boolean
  isCoCommissioner: boolean
  rank: number | null
  pointsFor: number | null
  wins: number | null
  losses: number | null
  isOpen: boolean
}

export type LeagueGroundingRosterPlayer = {
  playerId: string
  playerName: string
  position: string
  team: string | null
  injuryStatus: string | null
  adp: number | null
  projectedPoints: number | null
  isStarter: boolean
}

export type LeagueGroundingRoster = {
  userId: string
  teamName: string | null
  starters: LeagueGroundingRosterPlayer[]
  bench: LeagueGroundingRosterPlayer[]
}

export type LeagueGroundingDraft = {
  status: "pre_draft" | "in_progress" | "completed" | "unknown"
  type: string | null
  round: number | null
  pick: number | null
  completedAt: string | null
}

export type LeagueGroundingPlayerPoolSummary = {
  totalAvailable: number
  byPosition: Record<string, number>
  topAdpPlayers: Array<{
    playerName: string
    position: string
    team: string | null
    adp: number
    injuryStatus: string | null
  }>
  missingAdpCount: number
  missingProjectionCount: number
  dataSource: string | null
}

export type LeagueGroundingPacket = {
  // ── Identity ─────────────────────────────────────────────────────────────
  sport: string
  leagueId: string
  userId: string
  season: number | null
  builtAt: string

  // ── League settings ───────────────────────────────────────────────────────
  leagueContext: {
    name: string | null
    isCommissioner: boolean
    isCoCommissioner: boolean
    openSlots: number
    totalSlots: number
    status: string | null
  }
  settings: LeagueGroundingSettings | null

  // ── Managers ──────────────────────────────────────────────────────────────
  managers: LeagueGroundingManager[] | null

  // ── Viewer's roster ────────────────────────────────────────────────────────
  rosters: LeagueGroundingRoster[] | null

  // ── Draft ─────────────────────────────────────────────────────────────────
  draft: LeagueGroundingDraft | null

  // ── Player pool ───────────────────────────────────────────────────────────
  playerPool: LeagueGroundingPlayerPoolSummary | null

  // ── Provider data ─────────────────────────────────────────────────────────
  fantasyData: {
    hasPlayerData: boolean
    hasAdpData: boolean
    hasInjuryData: boolean
    hasScheduleData: boolean
    playerCount: number
    adpCount: number
    injuryCount: number
    topInjuries: Array<{
      playerName: string
      team: string | null
      status: string
      position: string
    }>
  } | null

  // ── Evidence & freshness ──────────────────────────────────────────────────
  evidence: FantasyDataEvidenceSnapshot | null
  freshness: FantasyFreshnessReport | null
  providerHealth: (Pick<FantasyProviderHealthReport, "sport" | "counts" | "lastSyncedAt" | "missingEnv" | "stale" | "errors" | "warnings"> & {
    providers: Array<Pick<FantasyProviderHealthReport["providers"][number], "id" | "priority" | "configured" | "status" | "lastSuccessfulImport" | "freshness">>
    domains: Array<Pick<FantasyProviderHealthReport["domains"][number], "domain" | "count" | "lastSyncedAt" | "freshness" | "status" | "evidenceReturnedToAI">>
  }) | null
  newsDigest: Array<{
    headline: string
    playerName: string | null
    team: string | null
    source: string | null
    publishedAt: string | null
    impact: string | null
  }> | null
  weatherEvidence: Array<{
    eventId: string | null
    forecastForTime: string | null
    condition: string | null
    temperatureF: number | null
    windSpeedMph: number | null
    isIndoor: boolean
    source: string | null
  }> | null
  scheduleSummary: {
    gameCount: number
    upcomingCount: number
    completedCount: number
    lastSyncedAt: string | null
  } | null
  standingsSummary: {
    available: boolean
    rowCount: number
    lastSyncedAt: string | null
    source: string | null
  } | null

  // ── AI enforcement ────────────────────────────────────────────────────────
  unavailable: string[]
  safeAnswerRules: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentSeason(): number {
  return new Date().getFullYear()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function firstBoolean(...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === "boolean") return value
  }
  return false
}

function resolveSettings(league: Record<string, unknown>): LeagueGroundingSettings {
  const settings = asRecord(league.settings)
  const scoringSettings = asRecord(settings.scoringSettings ?? settings.scoring)
  const draftSettings = asRecord(settings.draftSettings ?? settings.draft)
  const rosterSettings = asRecord(settings.rosterSettings ?? settings.roster)
  const flags = asRecord(settings.flags)
  const leagueSettings = asRecord(league.leagueSettings)
  const scoringPreset = firstString(
    league.scoringPreset,
    settings.scoringPreset,
    scoringSettings.preset,
    league.scoring,
    league.scoringPresetId,
  )
  const scoring = String(scoringPreset ?? league.scoring ?? "").toLowerCase()
  const draftType = firstString(league.draftType, leagueSettings.draftType, settings.draftType, draftSettings.draftType)
  const numTeams = firstNumber(league.numTeams, league.leagueSize, settings.numTeams, settings.teamCount, settings.leagueSize) ?? 12
  return {
    sport: String(league.sport ?? "NFL"),
    leagueType: String(league.leagueType ?? league.format ?? "redraft"),
    scoringPreset,
    draftType,
    numTeams,
    isSuperflex: firstBoolean(league.isSuperflex, league.superflex, settings.isSuperflex, flags.isSuperFlex, flags.isSuperflex),
    isPPR: scoring.includes("ppr") && !scoring.includes("half"),
    isHalfPPR: scoring.includes("half_ppr") || scoring.includes("half-ppr"),
    isStandard: scoring.includes("std") || scoring.includes("standard"),
    isIDP: firstBoolean(league.idp, settings.idp, flags.isIDP) || scoring.includes("idp"),
    isBestBall: String(league.leagueType ?? "").includes("best_ball"),
    isDynasty: firstBoolean(league.isDynasty, settings.isDynasty) || String(league.leagueType ?? "").includes("dynasty"),
    isKeeper: String(league.leagueType ?? "").includes("keeper"),
    playoffTeams: league.playoffTeams != null ? Number(league.playoffTeams) : null,
    playoffWeekStart: firstNumber(league.playoffWeekStart, league.playoffStartWeek),
    rosterSlots: firstNumber(league.rosterSlots, league.rosterSize, rosterSettings.rosterSize, rosterSettings.totalSlots),
    benchSlots: firstNumber(league.benchSlots, rosterSettings.benchSlots),
    irSlots: league.irSlots != null ? Number(league.irSlots) : null,
    taxiSlots: league.taxiSlots != null ? Number(league.taxiSlots) : null,
    waiverType: String(league.waiverType ?? "") || null,
    faabBudget: firstNumber(league.faabBudget, league.waiverBudget),
    tradeDeadline: firstNumber(league.tradeDeadline, league.tradeDeadlineWeek),
    season: league.season != null ? Number(league.season) : currentSeason(),
  }
}

function buildSafeAnswerRules(
  sport: string,
  freshness: FantasyFreshnessReport | null,
  evidence: FantasyDataEvidenceSnapshot | null,
): string[] {
  const rules: string[] = [
    "Answer ONLY from facts in this grounding packet. Never invent player stats, ADP, projections, injuries, or headshots.",
    "For any factual claim about players, cite the data source and freshness tier from the evidence object.",
    "If evidence.dataAvailability is 'unavailable' or 'pending', do not cite any player data as current fact.",
    "Distinguish deterministic league settings (always accurate from DB) from provider-backed sports data (may be stale or missing).",
    "If asked about data quality, cite freshness.summary verbatim.",
    "Do not guess ADP values. If adp is null for a player, say ADP is not available for that player.",
    "Do not invent injury statuses. If injuryStatus is null, say injury status is unknown.",
    "For premium advice, always explain your evidence source and confidence level.",
    "If a user asks 'what data are you using?', cite the evidence object: provider, season, counts, lastFullSyncAt.",
  ]

  if (freshness) {
    rules.push(freshness.aiInstruction)
  }

  if (evidence?.dataAvailability === "unavailable") {
    rules.push(
      `No ${sport} player data is currently in the database. Do not cite player names, stats, ADP, or injuries from any external knowledge.`,
    )
  }

  if (sport === "NCAAF" || sport === "ncaaf") {
    rules.push(
      "NCAAF devy and C2C data is in beta. If player pool shows 'pending', explicitly tell the user the NCAAF data pipeline is not yet connected.",
      "Do not invent NCAAF player rankings, stats, or college production metrics.",
    )
  }

  return rules
}

function buildUnavailableList(
  evidence: FantasyDataEvidenceSnapshot | null,
  draft: LeagueGroundingDraft | null,
  managers: LeagueGroundingManager[] | null,
): string[] {
  const missing: string[] = []
  if (!evidence || evidence.dataAvailability === "unavailable") {
    missing.push("player pool data (no import has run)")
    missing.push("ADP rankings (no import has run)")
    missing.push("injury reports (no import has run)")
  } else if (evidence.dataAvailability === "pending") {
    missing.push("player data (import pending)")
  } else {
    if (evidence.players.count === 0) missing.push("player records")
    if (evidence.adp.count === 0) missing.push("ADP data")
    if (evidence.injuries.count === 0) missing.push("current injury reports")
    if (evidence.schedules.count === 0) missing.push("schedules")
    if (evidence.projections.count === 0) missing.push("fantasy projections")
    if (evidence.news.count === 0) missing.push("player news")
    if (evidence.weather.count === 0) missing.push("game weather")
    if (evidence.standings.count === 0) missing.push("standings/rankings")
  }
  if (!draft || draft.status === "unknown") {
    missing.push("draft status (no draft session found)")
  }
  if (!managers || managers.length === 0) {
    missing.push("league managers (no teams found)")
  }
  return missing
}

// ─── DB loaders ───────────────────────────────────────────────────────────────

async function loadLeagueRow(leagueId: string): Promise<Record<string, unknown> | null> {
  try {
    return (await (prisma as any).league.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        name: true,
        sport: true,
        leagueType: true,
        leagueSize: true,
        scoring: true,
        scoringPresetId: true,
        isDynasty: true,
        rosterSize: true,
        status: true,
        season: true,
        settings: true,
        userId: true,
        playoffTeams: true,
        playoffStartWeek: true,
        irSlots: true,
        taxiSlots: true,
        waiverType: true,
        waiverBudget: true,
        tradeDeadlineWeek: true,
        leagueSettings: {
          select: {
            draftType: true,
          },
        },
      },
    })) ?? null
  } catch {
    return null
  }
}

async function loadManagers(leagueId: string, viewerUserId: string): Promise<LeagueGroundingManager[]> {
  try {
    const teams = await (prisma as any).leagueTeam.findMany({
      where: { leagueId },
      select: {
        id: true,
        teamName: true,
        claimedByUserId: true,
        pointsFor: true,
        wins: true,
        losses: true,
        currentRank: true,
        isCommissioner: true,
        isCoCommissioner: true,
        role: true,
      },
      take: 30,
    }).catch(() => []) as Array<Record<string, unknown>>

    const members = await (prisma as any).redraftMember.findMany({
      where: { leagueId },
      select: {
        userId: true,
        role: true,
        user: { select: { id: true, name: true, username: true } },
      },
      take: 30,
    }).catch(() => []) as Array<Record<string, unknown>>

    const memberMap = new Map<string, Record<string, unknown>>()
    for (const m of members) {
      if (m.userId) memberMap.set(String(m.userId), m)
    }

    return teams.map((t): LeagueGroundingManager => {
      const uid = String(t.claimedByUserId ?? "")
      const member = uid ? memberMap.get(uid) : undefined
      const user = member?.user as Record<string, unknown> | undefined
      const role = String(member?.role ?? "")
      return {
        userId: uid || `open:${t.id}`,
        displayName: String(user?.name ?? user?.username ?? (uid ? uid.slice(0, 8) : "Open slot")),
        teamName: t.teamName ? String(t.teamName) : null,
        isCommissioner: Boolean(t.isCommissioner) || role === "commissioner",
        isCoCommissioner: Boolean(t.isCoCommissioner) || role === "co_commissioner",
        rank: t.currentRank != null ? Number(t.currentRank) : null,
        pointsFor: t.pointsFor != null ? Number(t.pointsFor) : null,
        wins: t.wins != null ? Number(t.wins) : null,
        losses: t.losses != null ? Number(t.losses) : null,
        isOpen: !uid,
      }
    })
  } catch {
    return []
  }
}

async function loadViewerRoster(
  leagueId: string,
  userId: string,
): Promise<LeagueGroundingRoster | null> {
  try {
    const team = await (prisma as any).leagueTeam.findFirst({
      where: {
        leagueId,
        OR: [
          { claimedByUserId: userId },
          { platformUserId: userId },
        ],
      },
      select: {
        teamName: true,
        externalId: true,
        platformUserId: true,
      },
    }).catch(() => null) as Record<string, unknown> | null

    const rosterOwnerIds = [
      userId,
      team?.platformUserId,
      team?.externalId,
    ]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)

    const roster = await (prisma as any).roster.findFirst({
      where: {
        leagueId,
        OR: rosterOwnerIds.map((platformUserId) => ({ platformUserId })),
      },
      select: {
        playerData: true,
        settings: true,
      },
    }).catch(() => null)
    if (!roster) return null

    const parsePlayer = (p: unknown): LeagueGroundingRosterPlayer | null => {
      if (!p || typeof p !== "object") return null
      const r = p as Record<string, unknown>
      return {
        playerId: String(r.playerId ?? r.id ?? ""),
        playerName: String(r.name ?? r.playerName ?? ""),
        position: String(r.position ?? ""),
        team: r.team ? String(r.team) : null,
        injuryStatus: r.injuryStatus ? String(r.injuryStatus) : null,
        adp: r.adp != null ? Number(r.adp) : null,
        projectedPoints: r.projectedPoints != null ? Number(r.projectedPoints) : null,
        isStarter: Boolean(r.isStarter),
      }
    }

    const allPlayers: LeagueGroundingRosterPlayer[] = []
    const raw = (Array.isArray(roster.playerData) ? roster.playerData : []) as unknown[]
    for (const p of raw) {
      const parsed = parsePlayer(p)
      if (parsed) allPlayers.push(parsed)
    }

    const rosterSettings = asRecord(roster.settings)
    const starterIds = new Set<string>(
      Array.isArray(rosterSettings.starters) ? rosterSettings.starters.map(String) : [],
    )

    return {
      userId,
      teamName: team?.teamName ? String(team.teamName) : null,
      starters: allPlayers.filter((p) => starterIds.has(p.playerId) || p.isStarter),
      bench: allPlayers.filter((p) => !starterIds.has(p.playerId) && !p.isStarter),
    }
  } catch {
    return null
  }
}

async function loadDraftStatus(leagueId: string): Promise<LeagueGroundingDraft | null> {
  try {
    const session = await (prisma as any).draftSession.findFirst({
      where: { leagueId },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        currentRoundNum: true,
        nextOverallPick: true,
        draftType: true,
        completedAt: true,
      },
    }).catch(() => null)

    if (!session) return { status: "pre_draft", type: null, round: null, pick: null, completedAt: null }

    const rawStatus = String(session.status ?? "")
    const status: LeagueGroundingDraft["status"] =
      rawStatus === "in_progress" ? "in_progress"
      : rawStatus === "completed" ? "completed"
      : rawStatus === "pre_draft" ? "pre_draft"
      : "unknown"

    return {
      status,
      type: session.draftType ? String(session.draftType) : null,
      round: session.currentRoundNum != null ? Number(session.currentRoundNum) : null,
      pick: session.nextOverallPick != null ? Number(session.nextOverallPick) : null,
      completedAt:
        session.completedAt instanceof Date
          ? session.completedAt.toISOString()
          : typeof session.completedAt === "string"
            ? session.completedAt
            : null,
    }
  } catch {
    return null
  }
}

async function loadPlayerPoolSummary(
  sport: string,
  season: number,
): Promise<LeagueGroundingPlayerPoolSummary | null> {
  try {
    const [players, adpRows] = await Promise.all([
      (prisma as any).sportsPlayerRecord.findMany({
        where: { sport },
        select: {
          id: true,
          name: true,
          position: true,
          team: true,
          adp: true,
          injuryStatus: true,
          dataSource: true,
        },
        orderBy: [{ adp: "asc" }, { name: "asc" }],
        take: 500,
      }).catch(() => []) as Promise<Array<Record<string, unknown>>>,
      (prisma as any).adpDataRecord.findMany({
        where: { sport, season },
        select: {
          playerId: true,
          playerName: true,
          position: true,
          team: true,
          adp: true,
          source: true,
        },
        orderBy: { adp: "asc" },
        distinct: ["playerId"],
        take: 30,
      }).catch(() => []) as Promise<Array<Record<string, unknown>>>,
    ])

    if (players.length === 0) return null

    const byPosition: Record<string, number> = {}
    let missingAdp = 0
    let missingProj = 0
    const playerById = new Map<string, Record<string, unknown>>()
    const playerByName = new Map<string, Record<string, unknown>>()

    for (const p of players) {
      const pos = String(p.position ?? "FLEX")
      byPosition[pos] = (byPosition[pos] ?? 0) + 1
      if (p.adp == null) missingAdp++
      missingProj++ // projections not in SportsPlayerRecord yet
      if (p.id) playerById.set(String(p.id), p)
      if (p.name) playerByName.set(String(p.name).trim().toLowerCase(), p)
    }

    let topAdp = players
      .filter((p) => p.adp != null)
      .slice(0, 30)
      .map((p) => ({
        playerName: String(p.name ?? ""),
        position: String(p.position ?? ""),
        team: p.team ? String(p.team) : null,
        adp: Number(p.adp),
        injuryStatus: p.injuryStatus ? String(p.injuryStatus) : null,
      }))

    if (topAdp.length === 0 && adpRows.length > 0) {
      topAdp = adpRows.map((row) => {
        const player =
          playerById.get(String(row.playerId ?? "")) ??
          playerByName.get(String(row.playerName ?? "").trim().toLowerCase())
        return {
          playerName: String(row.playerName ?? player?.name ?? ""),
          position: String(row.position ?? player?.position ?? ""),
          team: row.team ? String(row.team) : player?.team ? String(player.team) : null,
          adp: Number(row.adp),
          injuryStatus: player?.injuryStatus ? String(player.injuryStatus) : null,
        }
      })
    }

    const dataSource =
      players[0]?.dataSource ? String(players[0].dataSource)
      : adpRows[0]?.source ? String(adpRows[0].source)
      : null

    return {
      totalAvailable: players.length,
      byPosition,
      topAdpPlayers: topAdp,
      missingAdpCount: missingAdp,
      missingProjectionCount: missingProj,
      dataSource,
    }
  } catch {
    return null
  }
}

async function loadFantasyData(sport: string, season: number): Promise<LeagueGroundingPacket["fantasyData"]> {
  try {
    const [playerCount, adpCount, injuryCount, scheduleCount, topInjuries] = await Promise.all([
      (prisma as any).sportsPlayerRecord.count({ where: { sport } }).catch(() => 0) as Promise<number>,
      (prisma as any).adpDataRecord.count({ where: { sport } }).catch(() => 0) as Promise<number>,
      // Injury freshness comes from the canonical port. injury_report_records was
      // orphaned when the cron moved to sports_injuries and froze at 2026-04-28,
      // so both this count and the list below described a dead table while the
      // packet reported hasInjuryData: true.
      listInjuryFacts({ sport, limit: 200 })
        .then((l) => (l.facts ?? []).filter((f) => !f.stale).length)
        .catch(() => 0) as Promise<number>,
      (prisma as any).sportsGame.count({ where: { sport, season } }).catch(() => 0) as Promise<number>,
      listInjuryFacts({
        sport,
        statuses: ["Out", "Doubtful", "Questionable"],
        limit: 20,
      })
        .then((l) =>
          (l.facts ?? [])
            .filter((f) => !f.stale)
            .map((f) => ({ playerName: f.playerName, team: f.team, status: f.status }))
        )
        .catch(() => []) as Promise<Array<Record<string, unknown>>>,
    ])

    return {
      hasPlayerData: Number(playerCount) > 0,
      hasAdpData: Number(adpCount) > 0,
      hasInjuryData: Number(injuryCount) > 0,
      hasScheduleData: Number(scheduleCount) > 0,
      playerCount: Number(playerCount),
      adpCount: Number(adpCount),
      injuryCount: Number(injuryCount),
      topInjuries: topInjuries.map((i) => ({
        playerName: String(i.playerName ?? ""),
        team: i.team ? String(i.team) : null,
        status: String(i.status ?? ""),
        position: "",
      })),
    }
  } catch {
    return null
  }
}

// ─── Public builder ────────────────────────────────────────────────────────────

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value
  }
  return null
}

function compactProviderHealth(
  report: FantasyProviderHealthReport | null,
): LeagueGroundingPacket["providerHealth"] {
  if (!report) return null
  return {
    sport: report.sport,
    counts: report.counts,
    lastSyncedAt: report.lastSyncedAt,
    missingEnv: report.missingEnv,
    stale: report.stale,
    errors: report.errors.slice(0, 5),
    warnings: report.warnings.slice(0, 12),
    providers: report.providers.map((provider) => ({
      id: provider.id,
      priority: provider.priority,
      configured: provider.configured,
      status: provider.status,
      lastSuccessfulImport: provider.lastSuccessfulImport,
      freshness: provider.freshness,
    })),
    domains: report.domains.map((domain) => ({
      domain: domain.domain,
      count: domain.count,
      lastSyncedAt: domain.lastSyncedAt,
      freshness: domain.freshness,
      status: domain.status,
      evidenceReturnedToAI: domain.evidenceReturnedToAI,
    })),
  }
}

async function loadNewsDigest(sport: string): Promise<LeagueGroundingPacket["newsDigest"]> {
  try {
    const [playerNews, sportsNews] = await Promise.all([
      (prisma as any).playerNewsRecord.findMany({
        where: { sport },
        select: { headline: true, playerName: true, team: true, source: true, publishedAt: true, impact: true },
        orderBy: { publishedAt: "desc" },
        take: 8,
      }).catch(() => []) as Promise<Array<Record<string, unknown>>>,
      (prisma as any).sportsNews.findMany({
        where: { sport },
        select: { title: true, playerName: true, team: true, source: true, publishedAt: true, category: true },
        orderBy: { publishedAt: "desc" },
        take: 8,
      }).catch(() => []) as Promise<Array<Record<string, unknown>>>,
    ])

    const rows = [
      ...playerNews.map((row) => ({
        headline: String(row.headline ?? ""),
        playerName: row.playerName ? String(row.playerName) : null,
        team: row.team ? String(row.team) : null,
        source: row.source ? String(row.source) : null,
        publishedAt: toIso(row.publishedAt),
        impact: row.impact ? String(row.impact) : null,
      })),
      ...sportsNews.map((row) => ({
        headline: String(row.title ?? ""),
        playerName: row.playerName ? String(row.playerName) : null,
        team: row.team ? String(row.team) : null,
        source: row.source ? String(row.source) : null,
        publishedAt: toIso(row.publishedAt),
        impact: row.category ? String(row.category) : null,
      })),
    ]
      .filter((row) => row.headline)
      .sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"))
      .slice(0, 8)

    return rows.length > 0 ? rows : null
  } catch {
    return null
  }
}

async function loadWeatherEvidence(sport: string): Promise<LeagueGroundingPacket["weatherEvidence"]> {
  try {
    const rows = await (prisma as any).weatherCache.findMany({
      where: { sport },
      select: {
        eventId: true,
        forecastForTime: true,
        conditionLabel: true,
        temperatureF: true,
        windSpeedMph: true,
        isIndoor: true,
        isDome: true,
        roofClosed: true,
        dataSource: true,
      },
      orderBy: { fetchedAt: "desc" },
      take: 8,
    }).catch(() => []) as Array<Record<string, unknown>>

    const mapped = rows.map((row) => ({
      eventId: row.eventId ? String(row.eventId) : null,
      forecastForTime: toIso(row.forecastForTime),
      condition: row.conditionLabel ? String(row.conditionLabel) : null,
      temperatureF: row.temperatureF != null ? Number(row.temperatureF) : null,
      windSpeedMph: row.windSpeedMph != null ? Number(row.windSpeedMph) : null,
      isIndoor: Boolean(row.isIndoor || row.isDome || row.roofClosed),
      source: row.dataSource ? String(row.dataSource) : null,
    }))
    return mapped.length > 0 ? mapped : null
  } catch {
    return null
  }
}

async function loadScheduleSummary(
  sport: string,
  season: number,
): Promise<LeagueGroundingPacket["scheduleSummary"]> {
  try {
    const now = new Date()
    const [gameCount, upcomingCount, completedCount, latest] = await Promise.all([
      (prisma as any).sportsGame.count({ where: { sport, season } }).catch(() => 0) as Promise<number>,
      (prisma as any).sportsGame.count({ where: { sport, season, startTime: { gte: now } } }).catch(() => 0) as Promise<number>,
      (prisma as any).sportsGame.count({
        where: {
          sport,
          season,
          OR: [
            { homeScore: { not: null } },
            { awayScore: { not: null } },
            { status: { in: ["final", "Final", "completed", "Completed"] } },
          ],
        },
      }).catch(() => 0) as Promise<number>,
      (prisma as any).sportsGame.findFirst({
        where: { sport, season },
        select: { fetchedAt: true },
        orderBy: { fetchedAt: "desc" },
      }).catch(() => null) as Promise<Record<string, unknown> | null>,
    ])

    return {
      gameCount: Number(gameCount),
      upcomingCount: Number(upcomingCount),
      completedCount: Number(completedCount),
      lastSyncedAt: toIso(latest?.fetchedAt),
    }
  } catch {
    return null
  }
}

async function loadStandingsSummary(
  sport: string,
): Promise<LeagueGroundingPacket["standingsSummary"]> {
  try {
    const sportUpper = sport.toUpperCase()
    const sportLower = sport.toLowerCase()
    const standingsCacheWhere = {
      OR: [
        { cacheKey: { startsWith: `${sportUpper}:standings:` } },
        { cacheKey: { startsWith: `${sportLower}:standings:` } },
      ],
    }
    const [rowCount, latest] = await Promise.all([
      (prisma as any).sportsDataCache.count({
        where: standingsCacheWhere,
      }).catch(() => 0) as Promise<number>,
      (prisma as any).sportsDataCache.findFirst({
        where: standingsCacheWhere,
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
      }).catch(() => null) as Promise<Record<string, unknown> | null>,
    ])
    return {
      available: Number(rowCount) > 0,
      rowCount: Number(rowCount),
      lastSyncedAt: toIso(latest?.createdAt),
      source: Number(rowCount) > 0 ? "sports_data_cache" : null,
    }
  } catch {
    return null
  }
}

export async function buildLeagueSportsGroundingPacket(args: {
  leagueId: string
  userId: string
  sport?: string
  season?: number
}): Promise<LeagueGroundingPacket> {
  const { leagueId, userId } = args
  const builtAt = new Date().toISOString()

  const leagueRow = await loadLeagueRow(leagueId)
  const sport = String(args.sport ?? leagueRow?.sport ?? "NFL").toUpperCase()
  const season = args.season ?? (leagueRow?.season ? Number(leagueRow.season) : currentSeason())

  const [
    managers,
    viewerRoster,
    draft,
    playerPool,
    fantasyData,
    evidence,
    providerHealthReport,
    newsDigest,
    weatherEvidence,
    scheduleSummary,
    standingsSummary,
  ] = await Promise.all([
    loadManagers(leagueId, userId),
    loadViewerRoster(leagueId, userId),
    loadDraftStatus(leagueId),
    loadPlayerPoolSummary(sport, season),
    loadFantasyData(sport, season),
    loadFantasyDataEvidence({ sport, season }),
    loadFantasyProviderHealth({ sport, season }).catch(() => null),
    loadNewsDigest(sport),
    loadWeatherEvidence(sport),
    loadScheduleSummary(sport, season),
    loadStandingsSummary(sport),
  ])

  const freshness = evidence ? computeFantasyFreshness(evidence) : null
  const providerHealth = compactProviderHealth(providerHealthReport)

  const settings = leagueRow ? resolveSettings(leagueRow) : null

  const commissionerMember = managers.find((m) => m.isCommissioner)
  const isCommissioner = commissionerMember?.userId === userId
  const isCoCommissioner = managers.find((m) => m.isCoCommissioner && m.userId === userId) != null
  const openSlots = managers.filter((m) => m.isOpen).length
  const totalSlots = settings?.numTeams ?? managers.length

  const unavailable = buildUnavailableList(evidence, draft, managers)
  const safeAnswerRules = buildSafeAnswerRules(sport, freshness, evidence)

  return {
    sport,
    leagueId,
    userId,
    season,
    builtAt,
    leagueContext: {
      name: leagueRow?.name ? String(leagueRow.name) : null,
      isCommissioner,
      isCoCommissioner,
      openSlots,
      totalSlots,
      status: leagueRow?.status ? String(leagueRow.status) : null,
    },
    settings,
    managers: managers.length > 0 ? managers : null,
    rosters: viewerRoster ? [viewerRoster] : null,
    draft,
    playerPool,
    fantasyData,
    evidence,
    freshness,
    providerHealth,
    newsDigest,
    weatherEvidence,
    scheduleSummary,
    standingsSummary,
    unavailable,
    safeAnswerRules,
  }
}

/**
 * Serialize the grounding packet to the compact JSON string injected into AI prompts.
 * Enforcement fields are promoted to the top so the model sees them first.
 */
export function serializeLeagueGroundingForPrompt(packet: LeagueGroundingPacket): string {
  const { safeAnswerRules, unavailable, freshness, evidence, ...rest } = packet
  return JSON.stringify({
    _notice: "LEAGUE GROUNDING PACKET — only cite facts in this object. Never invent numbers.",
    _source: freshness?.summary ?? "Data freshness unknown.",
    _missing: unavailable,
    _rules: safeAnswerRules,
    freshness,
    evidence: evidence
      ? {
          dataAvailability: evidence.dataAvailability,
          playerCount: evidence.players.count,
          adpCount: evidence.adp.count,
          injuryCount: evidence.injuries.count,
          scheduleCount: evidence.schedules.count,
          teamCount: evidence.teams.count,
          scoreCount: evidence.scores.count,
          standingsCount: evidence.standings.count,
          newsCount: evidence.news.count,
          weatherCount: evidence.weather.count,
          projectionCount: evidence.projections.count,
          fantasyValueCount: evidence.fantasyValues.count,
          depthChartCount: evidence.depthCharts.count,
          seasonStatCount: evidence.seasonStats.count,
          gameLogCount: evidence.gameLogs.count,
          idpStatCount: evidence.idpStats.count,
          lastFullSyncAt: evidence.lastFullSyncAt,
          missingEnv: evidence.missingEnv,
          warnings: evidence.warnings,
        }
      : null,
    ...rest,
  })
}

function domainStatusLine(
  label: string,
  domain: { count: number; lastImportedAt?: string | null; provider?: string | null } | null | undefined,
): string {
  if (!domain) return `${label}: unavailable`
  const provider = domain.provider ? ` via ${domain.provider}` : ""
  const updated = domain.lastImportedAt ? `, updated ${domain.lastImportedAt}` : ""
  return `${label}: ${domain.count} row(s)${provider}${updated}`
}

export function buildLeagueDataUsageAnswer(packet: LeagueGroundingPacket): string {
  const settings = packet.settings
  const evidence = packet.evidence
  const leagueContext = packet.leagueContext
  const managerCount = packet.managers?.length ?? 0
  const openSlots = leagueContext.openSlots
  const commissionerStatus = leagueContext.isCommissioner
    ? "you are commissioner"
    : leagueContext.isCoCommissioner
      ? "you are co-commissioner"
      : "you are not marked as commissioner"

  const settingLine = settings
    ? [
        `Sport ${settings.sport}`,
        `format ${settings.leagueType}`,
        settings.scoringPreset ? `scoring ${settings.scoringPreset}` : null,
        settings.draftType ? `draft ${settings.draftType}` : null,
        `${settings.numTeams} teams`,
      ].filter(Boolean).join(", ")
    : `Sport ${packet.sport}; league settings were not loaded from DB.`

  const domains = evidence
    ? [
        domainStatusLine("players", evidence.players),
        domainStatusLine("ADP", evidence.adp),
        domainStatusLine("projections", evidence.projections),
        domainStatusLine("injuries", evidence.injuries),
        domainStatusLine("news", evidence.news),
        domainStatusLine("weather", evidence.weather),
        domainStatusLine("schedules", evidence.schedules),
        domainStatusLine("standings", evidence.standings),
      ]
    : ["provider-backed player data: unavailable"]

  const providerSummary = packet.providerHealth
    ? `Provider freshness: ${packet.freshness?.summary ?? "unknown"} Last synced: ${packet.providerHealth.lastSyncedAt ?? "unknown"}.`
    : `Provider freshness: ${packet.freshness?.summary ?? "unknown"}.`

  const missing = packet.unavailable.length > 0
    ? `Missing or stale domains: ${packet.unavailable.join(", ")}.`
    : "No missing domains are flagged in the current grounding packet."

  return [
    `I am using deterministic league settings from the AllFantasy database: ${settingLine}.`,
    `League context: ${managerCount} manager slot(s), ${openSlots} open slot(s), ${commissionerStatus}.`,
    `Player/provider data status: ${domains.join("; ")}.`,
    providerSummary,
    missing,
    "I will treat league settings as authoritative when leagueId is present, but I will label provider-backed player, injury, news, weather, schedule, standings, ADP, and projection data as missing or stale when the evidence says so.",
  ].join("\n")
}

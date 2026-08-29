/**
 * IDP Chimmy AI — all entry points call `requireAfSub()` first (wraps `requireAfSubUserIdOrThrow`, same gate as route `requireAfSub`).
 * Profiles and pools read REAL rows only: PBP-derived FantasyStatLine weeks and the
 * league's actual unrostered player pool. A player with no ingested line is absent —
 * never given a hash-generated stat line.
 */

import { prisma } from '@/lib/prisma'
import { requireAfSubUserIdOrThrow } from '@/lib/redraft/ai/requireAfSub'
import { isIdpLeague } from '@/lib/idp'
import { openaiChatText } from '@/lib/openai-client'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { computeIdpFantasyPoints, getMergedScoringRulesForLeague } from '@/lib/idp/scoringEngine'
import { getLatestIdpStatSeason, getRealIdpLinesForRosterIds } from '@/lib/idp/realStatLines'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { buildIdpKickerValueMap } from '@/lib/idp-kicker-values'

/** Lib equivalent of route `requireAfSub()` — must run before any IDP AI work. */
async function requireAfSub(): Promise<void> {
  await requireAfSubUserIdOrThrow()
}

const CHIMMY_IDP_RULE = `You are Chimmy, the AI assistant for IDP fantasy leagues on AllFantasy.
You explain and recommend using only the real ingested data provided. If a signal is marked unavailable, say so — never invent scores, snap counts, matchup ratings, injuries, or playing-time guarantees.
Keep answers concise and actionable.`

export type IdPlayerRow = {
  playerId: string
  name: string
  position: string
  team?: string
}

export type DefenderStartSitAnalysis = {
  starters: string[]
  sitters: string[]
  analysis: string
  week: number
}

export type IDPWaiverTarget = {
  rank: number
  name: string
  position: string
  team?: string
  reasoning: string
}

export type IDPMatchupReport = {
  defensiveHighlights: string
  opponentAdvantage: string
  analysis: string
  week: number
}

export type IDPTradeEval = {
  fairness_rating: string
  balance_impact: string
  recommendation: string
}

export type IDPRankingEntry = {
  rank: number
  name: string
  position: string
  team?: string
  projectedPts: number
  reasoning: string
}

export type IDPRankingList = {
  week: number
  positionFilter?: string
  entries: IDPRankingEntry[]
}

export type SleeperDefender = {
  name: string
  position: string
  team?: string
  reasoning: string
}

export type SnapShareReport = {
  concerns: Array<{ player: string; snap_share: number; trend: string; note: string }>
  positives: Array<{ player: string; snap_share: number; trend: string; note: string }>
  /** Set when the report is empty because the data source does not exist. */
  note?: string
}

export type ScarcityReport = {
  summary: string
  byPosition: Record<string, string>
}

export type PowerRankingsPost = {
  week: number
  lines: Array<{ rank: number; teamLabel: string; blurb: string }>
  fullText: string
}

/** Persisted under `League.settings.idpChimmyPrefs` (commissioner + AfSub). */
export type IdpChimmyPrefs = {
  startSitRecommendations?: boolean
  waiverBreakoutAlerts?: boolean
  matchupAnalysis?: boolean
  weeklyRankings?: boolean
  tradeBalanceAnalysis?: boolean
}

function isIdpPosition(pos: string): boolean {
  const p = pos.toUpperCase()
  return ['DE', 'DT', 'DL', 'LB', 'CB', 'S', 'SS', 'FS', 'DB'].includes(p)
}

/**
 * Real per-player profile from ingested PBP stat lines. `matchupRating` and
 * `snapShare` are GONE — neither has a real source (PBP carries stat events,
 * not snaps, and no defensive matchup-strength feed is ingested). Anything
 * that used them either dropped the factor or says "no matchup signal".
 */
export type IdpAiStatProfile = {
  /** Mean league-scored points across every ingested week this season. */
  seasonAvg: number
  /** League-scored points of the last ingested weeks (≤3, oldest → newest). */
  recent3: number[]
  /** Ingested weeks behind the numbers — 0 real weeks never reaches a profile. */
  weeksOfData: number
  trend: 'up' | 'down' | 'flat'
}

/**
 * Real profiles for a batch of roster/Sleeper player ids. Players with no
 * ingested stat line are ABSENT from the map — callers must treat absence as
 * "no data", never substitute an invented line.
 */
export async function resolveIdpAiProfiles(
  leagueId: string,
  playerIds: string[],
  week: number,
): Promise<Map<string, IdpAiStatProfile>> {
  const out = new Map<string, IdpAiStatProfile>()
  if (playerIds.length === 0) return out
  const season = await getLatestIdpStatSeason()
  if (!season) return out
  const rules = await getMergedScoringRulesForLeague(leagueId)
  const { linesByPlayer } = await getRealIdpLinesForRosterIds(playerIds, season, {
    throughWeek: Math.min(18, Math.max(1, week)),
  })
  for (const [pid, weeks] of linesByPlayer) {
    const pts = weeks.map((w) => computeIdpFantasyPoints(w.stats, rules).total)
    if (pts.length === 0) continue
    const seasonAvg = pts.reduce((a, b) => a + b, 0) / pts.length
    const recent3 = pts.slice(-3)
    const first = recent3[0] ?? 0
    const last = recent3[recent3.length - 1] ?? 0
    const trend: IdpAiStatProfile['trend'] = recent3.length < 2 ? 'flat' : last >= first ? 'up' : 'down'
    out.set(pid, { seasonAvg, recent3, weeksOfData: pts.length, trend })
  }
  return out
}

/** Single-player profile — null when no ingested lines exist for the player. */
export async function resolveIdpAiProfile(
  leagueId: string,
  playerId: string,
  week: number,
): Promise<IdpAiStatProfile | null> {
  const map = await resolveIdpAiProfiles(leagueId, [playerId], week)
  return map.get(playerId) ?? null
}

function startScore(p: IdpAiStatProfile): number {
  const recentAvg = p.recent3.length
    ? p.recent3.reduce((a, b) => a + b, 0) / p.recent3.length
    : p.seasonAvg
  return 0.6 * p.seasonAvg + 0.4 * recentAvg
}

async function assertIdpLeague(leagueId: string): Promise<void> {
  const ok = await isIdpLeague(leagueId)
  if (!ok) throw new Error('Not an IDP league')
}

async function getRosterForUser(leagueId: string, userId: string) {
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true, playerData: true },
  })
  return roster
}

function parseOffensivePlayers(playerData: unknown): Array<{ name: string; position: string }> {
  if (!Array.isArray(playerData)) return []
  const out: Array<{ name: string; position: string }> = []
  for (const raw of playerData) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const pos = String(o.position ?? o.pos ?? '').toUpperCase()
    if (!['QB', 'RB', 'WR', 'TE', 'FLEX', 'K'].includes(pos) && pos !== 'TAXI' && pos !== 'BN') continue
    out.push({
      name: String(o.name ?? o.playerName ?? 'Player').slice(0, 80),
      position: pos,
    })
  }
  return out
}

export function parseIdpPlayers(playerData: unknown): IdPlayerRow[] {
  if (!Array.isArray(playerData)) return []
  const out: IdPlayerRow[] = []
  for (const raw of playerData) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const pid = String(o.playerId ?? o.id ?? o.sleeperPlayerId ?? '')
    const pos = String(o.position ?? o.pos ?? '').toUpperCase()
    if (!pid || !isIdpPosition(pos)) continue
    out.push({
      playerId: pid,
      name: String(o.name ?? o.playerName ?? pid).slice(0, 80),
      position: pos,
      team: typeof o.team === 'string' ? o.team : undefined,
    })
  }
  return out
}

async function allLeagueRosterPlayerIds(leagueId: string): Promise<Set<string>> {
  const rows = await prisma.roster.findMany({
    where: { leagueId },
    select: { playerData: true },
  })
  const set = new Set<string>()
  for (const r of rows) {
    if (!Array.isArray(r.playerData)) continue
    for (const raw of r.playerData) {
      if (!raw || typeof raw !== 'object') continue
      const o = raw as Record<string, unknown>
      const pid = String(o.playerId ?? o.id ?? o.sleeperPlayerId ?? '')
      if (pid) set.add(pid)
    }
  }
  return set
}

/**
 * Real waiver pool: the league's actual unrostered defenders, from the same
 * sport player pool the offense-side waiver tools read. This replaced
 * `buildMockWaiverPool`, which invented "FA Defender N" players that do not
 * exist — advice about them was worthless by construction.
 */
export async function buildIdpWaiverPool(leagueId: string, limit: number): Promise<IdPlayerRow[]> {
  const taken = await allLeagueRosterPlayerIds(leagueId)
  const pool = await getPlayerPoolForLeague(leagueId, 'NFL', {
    limit: Math.max(limit * 4, 200),
    position: 'IDP_FLEX',
  })
  const out: IdPlayerRow[] = []
  const seen = new Set<string>()
  for (const p of pool) {
    const pid = String(p.external_source_id ?? p.player_id ?? '')
    if (!pid || taken.has(pid) || seen.has(pid)) continue
    if (!isIdpPosition(p.position)) continue
    seen.add(pid)
    out.push({
      playerId: pid,
      name: p.full_name,
      position: p.position.toUpperCase(),
      team: p.team_abbreviation ?? undefined,
    })
    if (out.length >= limit) break
  }
  return out
}

export async function getDefenderStartSitRec(
  leagueId: string,
  managerId: string,
  week: number
): Promise<DefenderStartSitAnalysis> {
  await requireAfSub()
  await assertIdpLeague(leagueId)

  const roster = await getRosterForUser(leagueId, managerId)
  if (!roster) throw new Error('Roster not found')
  const defenders = parseIdpPlayers(roster.playerData)
  if (defenders.length === 0) {
    return {
      starters: [],
      sitters: [],
      analysis: 'No IDP defenders found on your roster in this league snapshot.',
      week,
    }
  }

  const profiles = await resolveIdpAiProfiles(
    leagueId,
    defenders.map((d) => d.playerId),
    week,
  )
  const scored = defenders.flatMap((d) => {
    const profile = profiles.get(d.playerId)
    return profile ? [{ ...d, profile, score: startScore(profile) }] : []
  })
  const noData = defenders.filter((d) => !profiles.has(d.playerId))
  if (scored.length === 0) {
    return {
      starters: [],
      sitters: [],
      analysis:
        'No ingested stat lines for your IDP roster yet — recommendations appear once real weekly stats land.',
      week,
    }
  }
  scored.sort((a, b) => b.score - a.score)
  const starters = scored.slice(0, Math.min(4, scored.length)).map((s) => s.name)
  const sitters = scored.slice(Math.min(4, scored.length)).map((s) => s.name)

  const lines = scored.map(
    (s) =>
      `- ${s.name} (${s.position}, ${s.team ?? 'FA'}): avg ${s.profile.seasonAvg.toFixed(1)} IDP pts over ${s.profile.weeksOfData} wk, last ${s.profile.recent3.length}: [${s.profile.recent3.map((x) => x.toFixed(1)).join(', ')}]`
  )
  if (noData.length > 0) {
    lines.push(
      `- No ingested stat lines yet (excluded from ranking): ${noData.map((d) => d.name).join(', ')}`,
    )
  }

  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_IDP_RULE },
      {
        role: 'user',
        content: `Week ${week} NFL. Analyze these defensive players (real ingested stat lines; no snap-count or matchup data exists — do not invent any):\n${lines.join('\n')}\n\nRecommend who to start and who to bench. Format: START: (list), SIT: (list), then brief reasoning (1-2 sentences each group).`,
      },
    ],
    temperature: 0.45,
    maxTokens: 700,
  })
  const analysis = res.ok ? res.text : 'Chimmy could not reach the AI provider. Check OPENAI_API_KEY.'

  return { starters, sitters, analysis, week }
}

export async function getIDPWaiverTargets(
  leagueId: string,
  week: number,
  limit = 5
): Promise<IDPWaiverTarget[]> {
  await requireAfSub()
  await assertIdpLeague(leagueId)

  const pool = await buildIdpWaiverPool(leagueId, Math.max(limit * 4, 24))
  if (pool.length === 0) return []

  const profiles = await resolveIdpAiProfiles(
    leagueId,
    pool.map((p) => p.playerId),
    week,
  )
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { isDynasty: true },
  })
  /*
   * ⚠ DEFENDERS ONLY — NO KICKER REACHES THIS MAP, SO REMOVING THE KICKER LADDER CHANGED
   * NOTHING HERE. `buildIdpWaiverPool` filters every candidate through `isIdpPosition`,
   * which is false for `K`, so the pool cannot contain one. The `tierRank` blend below is a
   * DEFENDER ordering, and defender ordering is the half that was validated (value over
   * replacement tracks the market at Spearman ~0.9); kicker ordering failed the equivalent
   * test outright and no longer exists anywhere. A kicker added to this pool would arrive
   * with no value at all rather than a fabricated one — price it with
   * `resolveLeagueKickerValue` and do not rank it.
   */
  const tierValues = await buildIdpKickerValueMap(
    pool.map((p) => p.playerId),
    league?.isDynasty ?? false,
  )

  // Blend in RANK space: real ingested production and the tier-curve market
  // value have incompatible units, so each contributes an ordering, not points.
  const prodRank = new Map(
    [...pool]
      .sort((a, b) => {
        const pa = profiles.get(a.playerId)
        const pb = profiles.get(b.playerId)
        if (!pa && !pb) return 0
        if (!pa) return 1
        if (!pb) return -1
        return startScore(pb) - startScore(pa)
      })
      .map((p, i) => [p.playerId, i] as const),
  )
  const tierOf = (pid: string) => {
    const v = tierValues.get(pid)
    return v ? Math.max(v.value, v.redraftValue) : 0
  }
  const tierRank = new Map(
    [...pool].sort((a, b) => tierOf(b.playerId) - tierOf(a.playerId)).map((p, i) => [p.playerId, i] as const),
  )

  const ranked = [...pool]
    .sort(
      (a, b) =>
        (prodRank.get(a.playerId)! + tierRank.get(a.playerId)!) -
        (prodRank.get(b.playerId)! + tierRank.get(b.playerId)!),
    )
    .slice(0, limit)
    .map((p) => ({ ...p, pr: profiles.get(p.playerId) ?? null }))

  const describe = (r: (typeof ranked)[number]) =>
    r.pr
      ? `avg ${r.pr.seasonAvg.toFixed(1)} IDP pts over ${r.pr.weeksOfData} wk, trend ${r.pr.trend}`
      : 'no ingested stat lines yet — ranked on market tier value only'

  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_IDP_RULE },
      {
        role: 'user',
        content: `Top ${ranked.length} unrostered defenders in this league for Week ${week} (real ingested stats + market tier value; no snap or schedule data — do not invent any):\n${ranked
          .map((r, i) => `${i + 1}. ${r.name} ${r.position} ${r.team ?? ''} — ${describe(r)}`)
          .join('\n')}\n\nOne sentence each on why they are worth a claim, grounded only in the data above.`,
      },
    ],
    temperature: 0.5,
    maxTokens: 700,
  })

  const text = res.ok ? res.text : ''
  return ranked.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    position: r.position,
    team: r.team,
    reasoning: text ? text.split('\n')[i]?.trim() || text : describe(r),
  }))
}

export async function getIDPMatchupAnalysis(
  leagueId: string,
  managerId: string,
  week: number
): Promise<IDPMatchupReport> {
  await requireAfSub()
  await assertIdpLeague(leagueId)

  const mine = await getRosterForUser(leagueId, managerId)
  const myDef = parseIdpPlayers(mine?.playerData)
  const opponent = await prisma.roster.findFirst({
    where: { leagueId, NOT: { platformUserId: managerId } },
    select: { id: true, playerData: true },
  })
  const oppOff = parseOffensivePlayers(opponent?.playerData)
  const oppLabel = opponent ? `Opponent (${opponent.id.slice(0, 8)})` : 'Opponent'

  const myProfiles = await resolveIdpAiProfiles(
    leagueId,
    myDef.map((d) => d.playerId),
    week,
  )
  const myLines = myDef
    .map((d) => {
      const p = myProfiles.get(d.playerId)
      return p
        ? `${d.name} (${d.position}): avg ${p.seasonAvg.toFixed(1)} IDP pts over ${p.weeksOfData} wk, trend ${p.trend}`
        : `${d.name} (${d.position}): no ingested stat lines yet`
    })
    .join('\n')

  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_IDP_RULE },
      {
        role: 'user',
        content: `Week ${week}. My IDP defenders (real ingested stats only — no matchup-strength or snap data exists, do not invent any):\n${myLines || '(none parsed)'}\nOpponent: ${oppLabel}. Their offensive skill players (sample): ${oppOff.slice(0, 8).map((o) => `${o.name} (${o.position})`).join(', ') || 'unknown'}\nExplain where my IDP has tackle/sack upside based on their real production, and say plainly that no defensive matchup ranking is available.\nAlso note one way the opponent could outscore me on IDP this week.`,
      },
    ],
    temperature: 0.45,
    maxTokens: 650,
  })
  const analysis = res.ok ? res.text : 'AI unavailable.'

  return {
    defensiveHighlights: `Week ${week}: focus on tackle floor LBs if opponent runs often; edge rushers if pass-heavy scripts.`,
    opponentAdvantage: `${oppLabel} may lean on offensive pace — compare IDP ceiling vs your tackle-heavy starters.`,
    analysis,
    week,
  }
}

function parseIdpTradeEvalJson(text: string): IDPTradeEval | null {
  const tryParse = (raw: string): IDPTradeEval | null => {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>
      const fr = j.fairness_rating
      const bi = j.balance_impact
      const rec = j.recommendation
      if (typeof fr === 'string' && typeof bi === 'string' && typeof rec === 'string') {
        return { fairness_rating: fr, balance_impact: bi, recommendation: rec }
      }
    } catch {
      /* ignore */
    }
    return null
  }
  const t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) {
    const p = tryParse(fence[1].trim())
    if (p) return p
  }
  const i0 = t.indexOf('{')
  const i1 = t.lastIndexOf('}')
  if (i0 >= 0 && i1 > i0) return tryParse(t.slice(i0, i1 + 1))
  return null
}

export async function evaluateIDPTrade(
  leagueId: string,
  managerId: string,
  offeredPlayers: string[],
  receivedPlayers: string[]
): Promise<IDPTradeEval> {
  await requireAfSub()
  await assertIdpLeague(leagueId)

  const roster = await getRosterForUser(leagueId, managerId)
  const all = parseIdpPlayers(roster?.playerData)
  const byId = new Map(all.map((p) => [p.playerId, p]))

  const describe = (ids: string[]) =>
    ids.map((id) => byId.get(id)?.name ?? id).join(', ') || '(unknown ids — pass Sleeper/player ids from roster)'

  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_IDP_RULE },
      {
        role: 'user',
        content: `IDP trade lens. Offered: ${describe(offeredPlayers)}. Receive: ${describe(receivedPlayers)}.
Evaluate offense vs defense balance, IDP scoring ceiling, positional holes, and fairness vs league norms.
Reply with ONLY a JSON object (no markdown) with keys:
  "fairness_rating": short label (e.g. "fair", "slight win for you", "slight loss", "risky"),
  "balance_impact": one paragraph on roster balance after trade (include rough % IDP vs offense if inferable),
  "recommendation": one paragraph accept/decline/counter guidance.`,
      },
    ],
    temperature: 0.45,
    maxTokens: 600,
  })
  const text = res.ok ? res.text : 'AI unavailable.'
  const parsed = res.ok ? parseIdpTradeEvalJson(text) : null
  if (parsed) return parsed
  return {
    fairness_rating: 'unparsed',
    balance_impact: text,
    recommendation: 'Use league trade review tools to confirm roster legality after any acceptance.',
  }
}

export async function getWeeklyIDPRankings(
  leagueId: string,
  week: number,
  positionFilter?: string
): Promise<IDPRankingList> {
  await requireAfSub()
  await assertIdpLeague(leagueId)

  const pool = await buildIdpWaiverPool(leagueId, 100)
  const profiles = await resolveIdpAiProfiles(
    leagueId,
    pool.map((p) => p.playerId),
    week,
  )
  // Only players with real ingested lines are ranked — a "projection" for a
  // player with no data would be an invented number.
  const scored = pool.flatMap((p) => {
    const pr = profiles.get(p.playerId)
    return pr ? [{ p, pr, proj: startScore(pr) }] : []
  })
  scored.sort((a, b) => b.proj - a.proj)

  const matchesPos = (pos: string, filter: string) => {
    const u = pos.toUpperCase()
    const f = filter.toUpperCase()
    if (f === 'DL') return ['DE', 'DT', 'DL'].includes(u)
    if (f === 'DB') return ['CB', 'S', 'SS', 'FS', 'DB'].includes(u)
    return u.includes(f) || f.includes(u)
  }

  const slice = positionFilter
    ? scored.filter((s) => matchesPos(s.p.position, positionFilter)).slice(0, 20)
    : scored.slice(0, 30)

  const entries: IDPRankingEntry[] = slice.map((s, i) => ({
    rank: i + 1,
    name: s.p.name,
    position: s.p.position,
    team: s.p.team,
    projectedPts: Math.round(s.proj * 10) / 10,
    reasoning: `Avg ${s.pr.seasonAvg.toFixed(1)} IDP pts over ${s.pr.weeksOfData} wk, trend ${s.pr.trend}`,
  }))

  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_IDP_RULE },
      {
        role: 'user',
        content: `Summarize IDP Week ${week} rankings theme in 2 sentences for: ${entries
          .slice(0, 8)
          .map((e) => e.name)
          .join(', ')}`,
      },
    ],
    temperature: 0.4,
    maxTokens: 300,
  })
  if (res.ok && entries[0]) entries[0].reasoning = `${entries[0].reasoning}. ${res.text.slice(0, 200)}`

  return { week, positionFilter, entries }
}

export async function getSleeperDefenders(leagueId: string, week: number): Promise<SleeperDefender[]> {
  await requireAfSub()
  await assertIdpLeague(leagueId)

  const pool = await buildIdpWaiverPool(leagueId, 60)
  const profiles = await resolveIdpAiProfiles(
    leagueId,
    pool.map((p) => p.playerId),
    week,
  )
  const posKey = (pos: string) =>
    ['DE', 'DT', 'DL'].includes(pos.toUpperCase()) ? 'DL' : pos.toUpperCase() === 'LB' ? 'LB' : 'DB'
  const withScores = pool.flatMap((p) => {
    const pr = profiles.get(p.playerId)
    return pr ? [{ p, pr, score: startScore(pr) }] : []
  })
  const byPos = new Map<string, Array<{ p: IdPlayerRow; score: number }>>()
  for (const row of withScores) {
    const k = posKey(row.p.position)
    const arr = byPos.get(k) ?? []
    arr.push({ p: row.p, score: row.score })
    byPos.set(k, arr)
  }
  for (const arr of byPos.values()) {
    arr.sort((a, b) => b.score - a.score)
  }
  const rankAtPos = (p: IdPlayerRow) => {
    const k = posKey(p.position)
    const arr = byPos.get(k) ?? []
    const idx = arr.findIndex((x) => x.p.playerId === p.playerId)
    return idx < 0 ? 99 : idx + 1
  }

  // "Sleeper" = unrostered in this league with real rising production.
  // Ownership percentages have no ingested source, so none are claimed.
  const out: SleeperDefender[] = []
  for (const { p, pr } of withScores) {
    const posRank = rankAtPos(p)
    if (pr.weeksOfData >= 2 && pr.trend === 'up' && posRank <= 10) {
      out.push({
        name: p.name,
        position: p.position,
        team: p.team,
        reasoning: `Unrostered here with rising real production: avg ${pr.seasonAvg.toFixed(1)} IDP pts over ${pr.weeksOfData} wk, top-${posRank} ${posKey(p.position)} in this pool.`,
      })
    }
    if (out.length >= 5) break
  }

  return out.slice(0, 5)
}

export async function getSnapShareInsights(leagueId: string, _managerId: string): Promise<SnapShareReport> {
  await requireAfSub()
  await assertIdpLeague(leagueId)

  /*
   * Snap counts have NO real source — the PBP feed carries stat events, not
   * snaps. This used to invent a share from a hash of the player id; an empty
   * report with the reason beats a fabricated percentage a manager acts on.
   */
  return {
    concerns: [],
    positives: [],
    note: 'Snap-count data is not ingested yet — per-player snap shares are unavailable.',
  }
}

export async function getIDPScarcityReport(leagueId: string, _week: number): Promise<ScarcityReport> {
  await requireAfSub()
  await assertIdpLeague(leagueId)

  const pool = await buildIdpWaiverPool(leagueId, 30)
  const byPos: Record<string, number> = { DL: 0, LB: 0, DB: 0 }
  for (const p of pool) {
    const g = ['DE', 'DT', 'DL'].includes(p.position) ? 'DL' : p.position === 'LB' ? 'LB' : 'DB'
    byPos[g] = (byPos[g] ?? 0) + 1
  }

  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_IDP_RULE },
      {
        role: 'user',
        content: `Unrostered IDP counts by bucket in this league: ${JSON.stringify(byPos)}. Explain scarcity for DL vs LB vs DB and actionable add/drop strategy before bye weeks.`,
      },
    ],
    temperature: 0.45,
    maxTokens: 500,
  })

  return {
    summary: res.ok ? res.text : 'AI unavailable.',
    byPosition: {
      DL: `${byPos.DL ?? 0} unrostered DL in this league.`,
      LB: `${byPos.LB ?? 0} unrostered LB — often thinnest in IDP.`,
      DB: `${byPos.DB ?? 0} unrostered DB — replaceable in big-play formats.`,
    },
  }
}

export async function generateIDPPowerRankings(leagueId: string, week: number): Promise<PowerRankingsPost> {
  await requireAfSub()
  await assertIdpLeague(leagueId)

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, playerData: true },
  })

  const scored = await Promise.all(
    rosters.map(async (r) => {
      const idps = parseIdpPlayers(r.playerData)
      const profiles = await resolveIdpAiProfiles(
        leagueId,
        idps.map((p) => p.playerId),
        week,
      )
      let sum = 0
      for (const p of idps) {
        const prof = profiles.get(p.playerId)
        if (prof) sum += startScore(prof)
      }
      return {
        teamLabel: `Team ${r.id.slice(0, 6)}`,
        sum,
        blurb:
          profiles.size > 0
            ? `IDP strength ~${sum.toFixed(1)} from ${profiles.size} of ${idps.length} defenders with ingested stats.`
            : `No ingested defensive stats yet for this roster (${idps.length} defenders).`,
      }
    }),
  )
  scored.sort((a, b) => b.sum - a.sum)
  const lines: PowerRankingsPost['lines'] = scored.map((s, i) => ({
    rank: i + 1,
    teamLabel: s.teamLabel,
    blurb: s.blurb,
  }))

  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_IDP_RULE },
      {
        role: 'user',
        content: `Write a commissioner power rankings post for Week ${week}:\n${lines
          .map((l) => `${l.rank}. ${l.teamLabel} — ${l.blurb}`)
          .join('\n')}\n\nOne sentence per team, fun but respectful.`,
      },
    ],
    temperature: 0.55,
    maxTokens: 900,
  })

  const fullText = res.ok ? res.text : lines.map((l) => `${l.rank}. ${l.teamLabel}`).join('\n')
  return { week, lines, fullText }
}

export async function saveIdpAiPrefs(leagueId: string, commissionerUserId: string, prefs: IdpChimmyPrefs): Promise<void> {
  await requireAfSub()
  await assertIdpLeague(leagueId)
  const ok = await isCommissioner(leagueId, commissionerUserId)
  if (!ok) throw new Error('Commissioner only')
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const prev = row?.settings
  const base =
    prev && typeof prev === 'object' && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {}
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...base, idpChimmyPrefs: prefs } },
  })
}

export function getIdpChimmyHelpText(): string {
  return [
    '🤖 **IDP @Chimmy commands**',
    '• `@chimmy idp rankings [position?]` — weekly IDP rankings',
    '• `@chimmy start sit defense [week?]` — your start/sit (private)',
    '• `@chimmy waiver targets defense [limit?]` — waiver ideas',
    '• `@chimmy matchup analysis [week?]` — your matchup (private)',
    '• `@chimmy snap analysis` — snap share notes (private)',
    '• `@chimmy idp sleepers` — low-owned upside',
    '• `@chimmy idp scarcity` — waiver scarcity by position',
    '• `@chimmy idp power rankings` — commissioner power rankings post',
    '• `@chimmy cap` — your cap summary (public)',
    '• `@chimmy contracts` — your salary list (public)',
    '• `@chimmy cut [name]` — cut dead-money preview (public)',
    '• `@chimmy extend [name]` — extension salary preview (public)',
    '• `@chimmy simulate defense cap` — IDP salary vs room snapshot (public)',
    '• `@chimmy cap advice` — AI cap moves (AfSub)',
    '• `@chimmy defender value [name]` — 10-pillar eval (AfSub)',
    '• `@chimmy contract eval [name] [cut|extend|tag]` — contract decision (AfSub)',
    '• `@chimmy cap efficiency` — pts/$ rankings (AfSub)',
    '• `@chimmy cap burden` — projection warnings (AfSub)',
    '• `@chimmy trade targets cap` — trade ideas (AfSub)',
    '• `@chimmy contender rebuild` — roster arc advice (AfSub)',
    '• `@chimmy weekly recap` — defensive recap (AfSub)',
    '• `@chimmy help idp` — this list',
    '',
    '🔒 AI IDP features require the AF Commissioner Subscription.',
  ].join('\n')
}

/** Single-player AI analysis (modal). */
export async function getIdpPlayerAiAnalysis(
  leagueId: string,
  managerId: string,
  week: number,
  playerId: string
): Promise<string> {
  await requireAfSub()
  await assertIdpLeague(leagueId)
  const roster = await getRosterForUser(leagueId, managerId)
  const defenders = parseIdpPlayers(roster?.playerData)
  const p = defenders.find((d) => d.playerId === playerId)
  if (!p) throw new Error('Player not on your IDP roster snapshot')
  const pr = await resolveIdpAiProfile(leagueId, playerId, week)
  if (!pr) throw new Error('No ingested stat lines for this player yet — analysis needs real weekly stats.')
  const { buildDefenderEvaluationContext, scoreDefender } = await import('@/lib/idp/ai/idpCapChimmy')
  const ctx = await buildDefenderEvaluationContext(leagueId, playerId, week, p)
  const evalModel = scoreDefender(ctx.profile, ctx.stats, ctx.salary, ctx.matchup, ctx.leagueConfig, ctx.formatType)
  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_IDP_RULE },
      {
        role: 'user',
        content: `Start/sit assessment for ${p.name} (${p.position}) Week ${week}.
Real ingested profile: ${JSON.stringify(pr)}
10-pillar evaluation (0-100): overall ${evalModel.overallGrade.toFixed(1)}, weekly start ${evalModel.weeklyStartGrade.toFixed(1)}, salary eff ${evalModel.salaryEfficiencyGrade.toFixed(1)}, risk ${evalModel.riskScore.toFixed(1)}.
Verdict hint: ${evalModel.verdict}. Top pillars: ${evalModel.pillarBreakdown.slice(0, 3).map((x) => `${x.name}=${x.score.toFixed(0)}`).join(', ')}.
Incorporate contract/salary context in 2-3 sentences when relevant.`,
      },
    ],
    temperature: 0.45,
    maxTokens: 500,
  })
  return res.ok ? res.text : 'AI unavailable.'
}

export async function assertCommissionerForPowerRankings(leagueId: string, userId: string): Promise<void> {
  const ok = await isCommissioner(leagueId, userId)
  if (!ok) throw new Error('Commissioner only')
}

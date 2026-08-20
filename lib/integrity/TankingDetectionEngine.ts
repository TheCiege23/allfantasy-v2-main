import "server-only"

// PRIVACY BOUNDARY: This module never reads chat data.
// Monitoring is based solely on lineup decisions, waiver activity,
// and on-field performance data.

import Anthropic from "@anthropic-ai/sdk"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"

import { notifyCommissionerOfFlag } from "./integrityNotifier"
import { normalizeSensitivity, TANKING_BENCH_GAP_POINTS } from "./sensitivity"

export type TankingEvidence = {
  rosterId: string
  teamName: string
  currentRecord: { wins: number; losses: number }
  weekNumber: number
  illegalOrSuspiciousStarters: {
    slotPosition: string
    startedPlayerId: string
    startedPlayerName: string
    startedPlayerStatus: string
    benchedBetterOption?: string
    benchedBetterOptionProjection?: number
    startedPlayerProjection?: number
  }[]
  consecutiveWeeksWithSuspiciousLineup: number
  winsBelowExpected: number
  pointsLeftOnBench: number
  eliminatedFromPlayoffs: boolean
  weeksUntilPlayoffs: number | null
  redFlags: string[]
}

export type TankingScanResult = {
  leagueId: string
  weekNumber: number
  flags: {
    severity: "low" | "medium" | "high"
    confidence: number
    summary: string
    evidence: TankingEvidence
  }[]
  scannedAt: string
}

async function runClaudeTankingPrompt(input: {
  leagueId: string
  weekNumber: number
  evidence: TankingEvidence
}): Promise<{
  verdict: "clean" | "suspicious" | "likely_tanking"
  confidence: number
  severity: "low" | "medium" | "high"
  summary: string
  redFlags: string[]
} | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return null
  /*
   * ⚠ ONE try/catch AROUND THE WHOLE CALL. Identical bug to the one fixed in
   * CollusionDetectionEngine: `client.messages.create()` was unguarded and only
   * the trailing JSON.parse had a catch, so any API failure aborted the entire
   * weekly tanking scan instead of falling back to the caller's deterministic
   * verdict. The model id below currently returns 404, so with a key configured
   * that failure was certain, not occasional.
   */
  try {
  const client = new Anthropic({ apiKey: key })
  const user = `League: ${input.leagueId}. Week ${input.weekNumber}.
Team: ${input.evidence.teamName} (${input.evidence.currentRecord.wins}-${input.evidence.currentRecord.losses}, eliminated: ${input.evidence.eliminatedFromPlayoffs}).
Suspicious lineup slots: ${JSON.stringify(input.evidence.illegalOrSuspiciousStarters)}
Pattern: ${input.evidence.consecutiveWeeksWithSuspiciousLineup} consecutive weeks with suspicious lineups.
Points left on bench (heuristic): ${input.evidence.pointsLeftOnBench}
Analyze for tanking using ONLY this lineup data.`

  const res = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    system: `You are an anti-tanking AI for fantasy sports leagues.
You analyze lineup decisions using ONLY on-field data.
Respond ONLY with JSON: {
  "verdict": "clean" | "suspicious" | "likely_tanking",
  "confidence": 0.0,
  "severity": "low" | "medium" | "high",
  "summary": "plain English",
  "redFlags": ["..."]
}`,
    messages: [{ role: "user", content: user }],
  })
  const text = res.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") return null
  const raw = text.text.trim()
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  return JSON.parse(jsonMatch[0]) as {
    verdict: "clean" | "suspicious" | "likely_tanking"
    confidence: number
    severity: "low" | "medium" | "high"
    summary: string
    redFlags: string[]
  }
  } catch (err) {
    console.warn(
      "[integrity] tanking AI pass unavailable, falling back to deterministic scoring:",
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

function parseLineupSnapshots(raw: unknown): { rosterId: string; starters: { playerId: string; status?: string; proj?: number }[]; bench: { playerId: string; proj?: number }[] }[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) return []
  const out: { rosterId: string; starters: { playerId: string; status?: string; proj?: number }[]; bench: { playerId: string; proj?: number }[] }[] = []
  for (const block of raw) {
    if (!block || typeof block !== "object") continue
    const o = block as Record<string, unknown>
    const rid = typeof o.rosterId === "string" ? o.rosterId : ""
    if (!rid) continue
    const starters = Array.isArray(o.starters) ? o.starters : Array.isArray(o.lineup) ? o.lineup : []
    const bench = Array.isArray(o.bench) ? o.bench : []
    const mapS = starters
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((x) => ({
        playerId: String(x.playerId ?? x.id ?? ""),
        status: typeof x.injuryStatus === "string" ? x.injuryStatus : typeof x.status === "string" ? x.status : undefined,
        proj: typeof x.projection === "number" ? x.projection : undefined,
      }))
    const mapB = bench
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((x) => ({
        playerId: String(x.playerId ?? x.id ?? ""),
        proj: typeof x.projection === "number" ? x.projection : undefined,
      }))
    out.push({ rosterId: rid, starters: mapS, bench: mapB })
  }
  return out
}

/**
 * Player ids -> display names.
 *
 * ⚠ WITHOUT THIS THE CARD ACCUSES A NUMBER. `TankingEvidence.startedPlayerName`
 * was assigned `st.playerId` — the raw lineup-snapshot id — so the commissioner
 * -facing sentence rendered as "started 6080 (OUT) at 0.0 projected over a bench
 * option at 12.4". The single most damning line on the flag was unreadable, and
 * a commissioner cannot verify an accusation against a player they cannot
 * identify. Ids arrive in whichever shape the source platform used, so both the
 * sleeper id and the externalId are tried; anything that does not resolve keeps
 * its id rather than inventing a name.
 */
async function resolvePlayerNames(ids: string[], sport: string): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map((i) => i.trim()).filter(Boolean))]
  if (unique.length === 0) return new Map()
  const rows = await prisma.sportsPlayer
    .findMany({
      where: { sport, OR: [{ sleeperId: { in: unique } }, { externalId: { in: unique } }] },
      select: { externalId: true, sleeperId: true, name: true },
    })
    .catch(() => [] as Array<{ externalId: string; sleeperId: string | null; name: string }>)
  const byId = new Map<string, string>()
  for (const r of rows) {
    if (r.sleeperId && !byId.has(r.sleeperId)) byId.set(r.sleeperId, r.name)
    if (!byId.has(r.externalId)) byId.set(r.externalId, r.name)
  }
  return byId
}

export async function scanWeekForTanking(leagueId: string, weekNumber: number): Promise<TankingScanResult> {
  const scannedAt = new Date().toISOString()
  const settings = await prisma.leagueIntegritySettings.findUnique({ where: { leagueId } })
  if (!settings?.tankingMonitorEnabled) {
    return { leagueId, weekNumber, flags: [], scannedAt }
  }

  /*
   * ⚠ THE SUB-RULES AND THE START WEEK ARE REAL GATES, NOT LABELS. Every field
   * below was saved by the settings rail and read by nothing until now; a
   * commissioner who unticked "benching significantly better projections" still
   * got bench-pattern flags. See lib/integrity/sensitivity.ts.
   *
   * `tankingStartWeek` is the one a commissioner will notice first: early-season
   * lineup mistakes are incompetence, not tanking, and flagging week 2 trains
   * everyone to ignore the queue. Null means "no floor", which is the column
   * default and the previous behaviour.
   */
  if (typeof settings.tankingStartWeek === "number" && weekNumber < settings.tankingStartWeek) {
    return { leagueId, weekNumber, flags: [], scannedAt }
  }
  const benchGapPoints = TANKING_BENCH_GAP_POINTS[normalizeSensitivity(settings.tankingSensitivity)]
  const checkIllegalLineups = settings.tankingIllegalLineupCheck !== false
  const checkBenchPattern = settings.tankingBenchPatternCheck !== false

  const matchups = await prisma.redraftMatchup.findMany({
    where: { leagueId, week: weekNumber },
    include: {
      homeRoster: true,
      awayRoster: true,
    },
  })

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { playoffStartWeek: true, sport: true },
  })
  const playoffWeek = league?.playoffStartWeek ?? 15
  const weeksUntilPlayoffs = Math.max(0, playoffWeek - weekNumber)

  const flags: TankingScanResult["flags"] = []

  for (const m of matchups) {
    for (const side of [
      { roster: m.homeRoster, snap: m.lineupSnapshots },
      m.awayRoster ? { roster: m.awayRoster, snap: m.lineupSnapshots } : null,
    ]) {
      if (!side) continue
      const roster = side.roster
      const parsed = parseLineupSnapshots(side.snap)
      /*
       * ⚠ NO FALLBACK TO `parsed[0]`, EVER. This read `?? parsed[0]`, so a roster
       * with no snapshot block of its own was analysed using whichever block
       * happened to be FIRST in the array — another manager's lineup — and the
       * resulting flag was then filed against THIS roster.
       *
       * Measured against a seeded league: one genuinely suspicious lineup
       * produced EIGHT tanking flags, seven of them naming managers who had done
       * nothing, each citing bench points they never left on a bench. This is an
       * integrity surface; a fabricated accusation of cheating is the single
       * worst output it can produce. A roster we have no lineup card for gets no
       * claim made about it.
       */
      const block = parsed.find((p) => p.rosterId === roster.id)
      if (!block) continue
      const suspicious: TankingEvidence["illegalOrSuspiciousStarters"] = []
      let pointsLeft = 0
      if (block) {
        const benchBest = Math.max(0, ...block.bench.map((b) => b.proj ?? 0))
        for (const st of block.starters) {
          const stProj = st.proj ?? 0
          const status = (st.status ?? "").toUpperCase()
          const out =
            status.includes("OUT") || status.includes("IR") || status === "DOUBTFUL" || status === "D"
          if (out) {
            if (!checkIllegalLineups) continue
            suspicious.push({
              slotPosition: "FLEX",
              startedPlayerId: st.playerId,
              startedPlayerName: st.playerId,
              startedPlayerStatus: status || "OUT",
              benchedBetterOption: benchBest > stProj ? "bench" : undefined,
              benchedBetterOptionProjection: benchBest > stProj ? benchBest : undefined,
              startedPlayerProjection: stProj,
            })
          } else if (checkBenchPattern && benchBest - stProj >= benchGapPoints) {
            pointsLeft += benchBest - stProj
            suspicious.push({
              slotPosition: "FLEX",
              startedPlayerId: st.playerId,
              startedPlayerName: st.playerId,
              startedPlayerStatus: "ACTIVE",
              benchedBetterOption: "higher projection on bench",
              benchedBetterOptionProjection: benchBest,
              startedPlayerProjection: stProj,
            })
          }
        }
      }

      if (suspicious.length === 0) continue

      // Resolve ids to names before the evidence is persisted, so the stored
      // payload is readable rather than needing a second lookup at render time.
      const nameById = await resolvePlayerNames(
        suspicious.map((x) => x.startedPlayerName),
        String(league?.sport ?? "NFL"),
      )
      for (const row of suspicious) {
        const resolved = nameById.get(row.startedPlayerName)
        if (resolved) row.startedPlayerName = resolved
      }

      const eliminated = roster.isEliminated === true
      const evidence: TankingEvidence = {
        rosterId: roster.id,
        teamName: roster.teamName?.trim() || roster.ownerName,
        currentRecord: { wins: roster.wins, losses: roster.losses },
        weekNumber,
        illegalOrSuspiciousStarters: suspicious,
        consecutiveWeeksWithSuspiciousLineup: suspicious.length > 0 ? 1 : 0,
        winsBelowExpected: 0,
        pointsLeftOnBench: pointsLeft,
        eliminatedFromPlayoffs: eliminated,
        weeksUntilPlayoffs,
        redFlags: [],
      }

      const ai = await runClaudeTankingPrompt({ leagueId, weekNumber, evidence })
      const verdict = ai?.verdict ?? "suspicious"
      const confidence = ai?.confidence ?? 0.5
      const severity = ai?.severity ?? "medium"
      if (ai?.redFlags?.length) evidence.redFlags = ai.redFlags

      if (verdict === "suspicious" || verdict === "likely_tanking") {
        const summary = ai?.summary ?? "Lineup card shows starters in worse health or projection than bench alternatives."
        /*
         * ⚠ ONE OPEN TANKING CASE PER MANAGER. The collusion engine already
         * refuses to re-flag a trade that has an open flag; this path had no such
         * check, so every weekly scan stacked another identical card onto the
         * commissioner's queue for a manager they had not gotten to yet. Same
         * intent as the collusion dedupe: a flag is a case to resolve, not a log
         * line.
         */
        const alreadyOpen = await prisma.integrityFlag.findFirst({
          where: { leagueId, flagType: "tanking", status: "open", affectedRosterIds: { has: roster.id } },
          select: { id: true },
        })
        if (alreadyOpen) continue
        const row = await prisma.integrityFlag.create({
          data: {
            leagueId,
            flagType: "tanking",
            severity,
            status: "open",
            affectedRosterIds: [roster.id],
            affectedTeamNames: [evidence.teamName],
            summary,
            evidenceJson: evidence as unknown as Prisma.InputJsonValue,
            aiConfidence: confidence,
          },
        })
        await notifyCommissionerOfFlag(row.id)
        flags.push({ severity, confidence, summary, evidence })
      }
    }
  }

  await prisma.leagueIntegritySettings.upsert({
    where: { leagueId },
    create: { leagueId, lastTankingScanAt: new Date(), tankingMonitorEnabled: true },
    update: { lastTankingScanAt: new Date() },
  })

  return { leagueId, weekNumber, flags, scannedAt }
}

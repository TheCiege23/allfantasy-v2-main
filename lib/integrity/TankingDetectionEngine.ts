import "server-only"

// PRIVACY BOUNDARY: This module never reads chat data.
// Monitoring is based solely on lineup decisions, waiver activity,
// and on-field performance data.

import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { ourIdOrSleeperIdWhere, playerRowKeys } from "@/lib/player-identity/externalIdNamespace"
import { isForeignIdSpace } from "@/lib/core-app/rosterIdSpace"

import { notifyCommissionerOfFlag } from "./integrityNotifier"
import { loadNativeLineupCards, type LineupCard } from "./nativeLineupCards"
import { normalizeSensitivity, TANKING_BENCH_GAP_POINTS, TANKING_IDLE_STARTS_PER_WEEK } from "./sensitivity"
import { loadDailySportIdleStarts } from "./dailySportTankingScan"
import {
  consecutiveRun,
  eligibleBench,
  maxSeverity,
  severityRank,
  starterSlot,
  tankingSeverity,
  tankingSummary,
  unplayableReason,
  type CardPlayer,
} from "./tankingRules"

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
    /** NBA / NHL / MLB daily lineups: the Eastern day of an idle start (`YYYY-MM-DD`). */
    day?: string
    /** The week this start happened in; an open case collects every week it was flagged for. */
    week?: number
  }[]
  consecutiveWeeksWithSuspiciousLineup: number
  /** Every week this case was flagged for, ascending. Absent on flags raised before it was tracked. */
  weeksFlagged?: number[]
  pointsLeftOnBench: number
  eliminatedFromPlayoffs: boolean
  weeksUntilPlayoffs: number | null
  redFlags: string[]
  /** `rules`: raised by the lineup rules (lib/integrity/tankingRules.ts), which carry no model confidence. */
  detector?: "rules"
  /** The flagged manager's explanation (lib/integrity/managerReply.ts). Carried across when a week extends the case. */
  managerReply?: { userId: string; text: string; submittedAt: string }
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

/*
 * No model is asked. The verdict, severity and summary come from lib/integrity/tankingRules.ts: the
 * model this scan used to call named an id that returns 404, so every flag it ever filed was the
 * same fallback "suspicious · medium · 50%".
 */

/** A legacy array-shaped snapshot card. Nothing writes one today; honoured if a writer adds it. */
type SnapshotCard = { rosterId: string; starters: CardPlayer[]; bench: CardPlayer[] }

function parseLineupSnapshots(raw: unknown): SnapshotCard[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) return []
  const out: SnapshotCard[] = []
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
        position: typeof x.position === "string" ? x.position : null,
        slot: typeof x.slot === "string" ? x.slot : undefined,
      }))
    const mapB = bench
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((x) => ({
        playerId: String(x.playerId ?? x.id ?? ""),
        status: typeof x.injuryStatus === "string" ? x.injuryStatus : typeof x.status === "string" ? x.status : undefined,
        proj: typeof x.projection === "number" ? x.projection : undefined,
        position: typeof x.position === "string" ? x.position : null,
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
 * identify. Anything that does not resolve keeps its id rather than inventing a
 * name.
 *
 * 🛑 AND A WRONG NAME IS WORSE THAN A NUMBER. This used to try "both the sleeper
 * id and the externalId", but `externalId` is where Rolling Insights keeps its OWN
 * numbers for different people: Sleeper 9228 is Bryce Young, RI 9228 is Michael
 * Tarquin, an offensive tackle. On this surface that becomes a commissioner told a
 * manager "started Michael Tarquin (OUT)" — an accusation about a player who was
 * never in the lineup. The redraft engine's ids are Sleeper ids or our own row ids
 * (`ourIdOrSleeperIdWhere`); a foreign league's ids are not looked up at all (see
 * the caller). externalIdNamespace.ts has the measurement.
 */
async function resolvePlayerNames(ids: string[], sport: string): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map((i) => i.trim()).filter(Boolean))]
  if (unique.length === 0) return new Map()
  const rows = await prisma.sportsPlayer
    .findMany({
      where: ourIdOrSleeperIdWhere(unique, sport),
      select: { id: true, sleeperId: true, source: true, name: true },
    })
    .catch(() => [] as Array<{ id: string; sleeperId: string | null; source: string; name: string }>)
  const byId = new Map<string, string>()
  const fromSleeper = new Set<string>()
  for (const r of rows) {
    for (const key of playerRowKeys(r)) {
      // Sleeper's own row wins a shared Sleeper id; otherwise the first row found.
      if (byId.has(key) && (fromSleeper.has(key) || r.source !== "sleeper")) continue
      byId.set(key, r.name)
      if (r.source === "sleeper") fromSleeper.add(key)
    }
  }
  return byId
}

export async function scanWeekForTanking(leagueId: string, weekNumber: number, seasonId?: string): Promise<TankingScanResult> {
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
  const sensitivity = normalizeSensitivity(settings.tankingSensitivity)
  const benchGapPoints = TANKING_BENCH_GAP_POINTS[sensitivity]
  const checkIllegalLineups = settings.tankingIllegalLineupCheck !== false
  const checkBenchPattern = settings.tankingBenchPatternCheck !== false

  const matchups = await prisma.redraftMatchup.findMany({
    where: { leagueId, week: weekNumber, ...(seasonId ? { seasonId } : {}) },
    include: {
      homeRoster: true,
      awayRoster: true,
      season: { select: { season: true } },
    },
  })

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { playoffStartWeek: true, sport: true, platform: true, settings: true },
  })
  // A foreign platform's player ids collide with Sleeper's; a stranger's name in an accusation is
  // worse than the bare id, so those are left unresolved (the same rule as nativeLineupScan).
  const resolvableIds = !isForeignIdSpace(league?.platform)
  const sport = String(league?.sport ?? "NFL")
  const playoffWeek = league?.playoffStartWeek ?? 15
  const weeksUntilPlayoffs = Math.max(0, playoffWeek - weekNumber)

  /*
   * The week's real lineup cards (lib/integrity/nativeLineupCards.ts). `lineupSnapshots` holds team
   * totals, never a per-player card, so without these the scan found nothing to read and flagged
   * nobody. An array-shaped snapshot is still honoured first, for any writer that adds one.
   */
  const seasonYear = matchups.map((m) => m.season?.season).find((y): y is number => typeof y === "number")
  const rosterIds = [...new Set(matchups.flatMap((m) => [m.homeRosterId, m.awayRosterId]).filter((id): id is string => typeof id === "string" && id.length > 0))]
  const cards =
    seasonYear != null && rosterIds.length > 0
      ? await loadNativeLineupCards(prisma, { redraftRosterIds: rosterIds, season: seasonYear, week: weekNumber })
      : new Map<string, LineupCard>()

  /*
   * NBA / NHL / MLB: idle starters, which the bye-week test below cannot see (these sports have no bye).
   * Daily lineups count idle starts against the sensitivity's weekly threshold (a bench-pattern rule);
   * weekly lineups treat a starter whose team plays no game all week as football's bye (an illegal
   * lineup). Null when the sport is another or the week's schedule cannot be read: no claim then.
   */
  const idleStarts =
    seasonYear != null && rosterIds.length > 0 && (checkIllegalLineups || checkBenchPattern)
      ? await loadDailySportIdleStarts(prisma, {
          sport: String(league?.sport ?? ""),
          leagueSettings: league?.settings ?? null,
          season: seasonYear,
          week: weekNumber,
          redraftRosterIds: rosterIds,
        }).catch((error) => {
          console.warn("[tanking] idle-start read failed; no idle-start claims this week", { leagueId, weekNumber, error: String(error) })
          return null
        })
      : null

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
      const block = parsed.find((p) => p.rosterId === roster.id) ?? cards.get(roster.id)
      const idle = idleStarts?.byRoster.get(roster.id) ?? []
      if (!block && idle.length === 0) continue
      const suspicious: TankingEvidence["illegalOrSuspiciousStarters"] = []
      let pointsLeft = 0
      if (block) {
        /*
         * ⚠ ONLY A BENCH PLAYER WHO COULD LEGALLY TAKE THE SLOT COUNTS (lib/integrity/tankingRules.ts).
         * This compared every starter against the best bench player of ANY position, and flagged any
         * unplayable starter whatever the bench held — so an OUT running back with only a healthy
         * quarterback behind him read as tanking. Each bench player answers for one starter at most,
         * so two OUT receivers and one healthy receiver on the bench is one choice, not two.
         */
        const usedBench = new Set<string>()
        for (const st of block.starters) {
          const stProj = st.proj ?? 0
          const alternatives = eligibleBench(st, block.bench, sport, weekNumber).filter((b) => !usedBench.has(b.playerId))
          const best = alternatives[0]
          const reason = unplayableReason(st, weekNumber)
          const slot = starterSlot(st) || "STARTER"
          if (reason) {
            if (!checkIllegalLineups || !best) continue
            usedBench.add(best.playerId)
            suspicious.push({
              slotPosition: slot,
              startedPlayerId: st.playerId,
              startedPlayerName: st.playerId,
              startedPlayerStatus: reason,
              benchedBetterOption: best.playerId,
              ...(typeof best.proj === "number" ? { benchedBetterOptionProjection: best.proj } : {}),
              ...(typeof st.proj === "number" ? { startedPlayerProjection: stProj } : {}),
              week: weekNumber,
            })
          } else if (checkBenchPattern && best && typeof best.proj === "number" && best.proj - stProj >= benchGapPoints) {
            usedBench.add(best.playerId)
            pointsLeft += best.proj - stProj
            suspicious.push({
              slotPosition: slot,
              startedPlayerId: st.playerId,
              startedPlayerName: st.playerId,
              startedPlayerStatus: "ACTIVE",
              benchedBetterOption: best.playerId,
              benchedBetterOptionProjection: best.proj,
              startedPlayerProjection: stProj,
              week: weekNumber,
            })
          }
        }
      }

      if (idleStarts?.mode === "weekly" && checkIllegalLineups) {
        for (const start of idle) {
          if (suspicious.some((x) => x.startedPlayerId === start.playerId)) continue
          suspicious.push({
            slotPosition: start.slot,
            startedPlayerId: start.playerId,
            startedPlayerName: start.playerId,
            startedPlayerStatus: "NO GAMES THIS WEEK",
            week: weekNumber,
          })
        }
      }
      if (idleStarts?.mode === "daily" && checkBenchPattern && idle.length >= TANKING_IDLE_STARTS_PER_WEEK[sensitivity]) {
        for (const start of idle) {
          suspicious.push({
            slotPosition: start.slot,
            startedPlayerId: start.playerId,
            startedPlayerName: start.playerId,
            startedPlayerStatus: "NO GAME THAT DAY",
            benchedBetterOption: start.benchPlayerId ?? undefined,
            ...(start.day ? { day: start.day } : {}),
            week: weekNumber,
          })
        }
      }

      if (suspicious.length === 0) continue

      // Resolve ids to names before the evidence is persisted, so the stored
      // payload is readable rather than needing a second lookup at render time.
      // The bench alternative is a player id on every path now, so it resolves too.
      const nameById = resolvableIds
        ? await resolvePlayerNames(
            suspicious.flatMap((x) => [x.startedPlayerName, x.benchedBetterOption ?? ""]).filter(Boolean),
            sport,
          )
        : new Map<string, string>()
      for (const row of suspicious) {
        const resolved = nameById.get(row.startedPlayerName)
        if (resolved) row.startedPlayerName = resolved
        const bench = row.benchedBetterOption ? nameById.get(row.benchedBetterOption) : undefined
        if (bench) row.benchedBetterOption = bench
      }

      const eliminated = roster.isEliminated === true
      const thisWeekPlayers = new Set(suspicious.map((x) => x.startedPlayerId)).size
      const idleOnly = suspicious.every((x) => x.startedPlayerStatus.startsWith("NO GAME"))

      /*
       * ⚠ ONE OPEN TANKING CASE PER MANAGER — AND A REPEAT WEEK EXTENDS IT. The first version of this
       * dedupe skipped any manager with an open case, so a manager who tanked three weeks running
       * produced one card saying "1 week", and the repetition that makes a case serious was thrown
       * away. The open case now collects every week it is flagged for, its severity rises with the
       * run, and the commissioner is alerted again only when it gets MORE serious.
       */
      const open = await prisma.integrityFlag.findFirst({
        where: { leagueId, flagType: "tanking", status: "open", affectedRosterIds: { has: roster.id } },
        select: { id: true, severity: true, evidenceJson: true },
      })
      const prior = (open?.evidenceJson && typeof open.evidenceJson === "object" ? open.evidenceJson : {}) as Partial<TankingEvidence>
      const priorWeeks = Array.isArray(prior.weeksFlagged)
        ? prior.weeksFlagged.filter((w): w is number => typeof w === "number")
        : typeof prior.weekNumber === "number"
          ? [prior.weekNumber]
          : []
      const weeksFlagged = [...new Set([...priorWeeks, weekNumber])].sort((a, b) => a - b)
      const consecutiveWeeks = consecutiveRun(weeksFlagged, weekNumber)
      const priorStarts = Array.isArray(prior.illegalOrSuspiciousStarters)
        ? prior.illegalOrSuspiciousStarters
            .filter((x) => (x.week ?? prior.weekNumber) !== weekNumber)
            .map((x) => ({ ...x, week: x.week ?? prior.weekNumber }))
        : []

      const computed = tankingSeverity({ suspiciousStarters: thisWeekPlayers, consecutiveWeeks, eliminated })
      const severity = open ? maxSeverity(open.severity, computed) : computed
      const summary = tankingSummary({ idleOnly, suspiciousStarters: thisWeekPlayers, consecutiveWeeks })
      const evidence: TankingEvidence = {
        rosterId: roster.id,
        teamName: roster.teamName?.trim() || roster.ownerName,
        currentRecord: { wins: roster.wins, losses: roster.losses },
        weekNumber,
        // This week's starts first: the card leads with the newest evidence.
        illegalOrSuspiciousStarters: [...suspicious, ...priorStarts],
        consecutiveWeeksWithSuspiciousLineup: consecutiveWeeks,
        weeksFlagged,
        // A week already in the case is never counted twice (a re-run of the same week).
        pointsLeftOnBench:
          (typeof prior.pointsLeftOnBench === "number" ? prior.pointsLeftOnBench : 0) + (priorWeeks.includes(weekNumber) ? 0 : pointsLeft),
        eliminatedFromPlayoffs: eliminated,
        weeksUntilPlayoffs,
        redFlags: [],
        detector: "rules",
        // A reply the manager already sent must survive the next week's scan.
        ...(prior.managerReply ? { managerReply: prior.managerReply } : {}),
      }

      if (open) {
        const escalated = severityRank(severity) > severityRank(open.severity)
        await prisma.integrityFlag.update({
          where: { id: open.id },
          data: {
            severity,
            summary,
            evidenceJson: evidence as unknown as Prisma.InputJsonValue,
            // Clearing the sent-stamp is what lets the notifier alert again; only when it got worse.
            ...(escalated ? { notifiedAt: null } : {}),
          },
        })
        if (escalated) await notifyCommissionerOfFlag(open.id)
        flags.push({ severity, confidence: 0, summary, evidence })
        continue
      }

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
          // Rules carry no model confidence; the card reads `detector` and hides this.
          aiConfidence: 0,
        },
      })
      await notifyCommissionerOfFlag(row.id)
      // Anti-tanking penalties: the manager is warned privately (lib/integrity/tankingPenaltyService.ts).
      await import("./tankingPenaltyService")
        .then(({ onTankingFlagOpened }) => onTankingFlagOpened(row.id))
        .catch((err) => console.error("[tanking] manager warning failed", err))
      flags.push({ severity, confidence: 0, summary, evidence })
    }
  }

  await prisma.leagueIntegritySettings.upsert({
    where: { leagueId },
    create: { leagueId, lastTankingScanAt: new Date(), tankingMonitorEnabled: true },
    update: { lastTankingScanAt: new Date() },
  })

  return { leagueId, weekNumber, flags, scannedAt }
}

import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkLeagueCommissionerEntitlement } from '@/lib/integrity/leagueEntitlement'
import { notifyCommissionerOfFlag } from '@/lib/integrity/integrityNotifier'
import { readLineupIntegrity, type LineupIntegrityReport } from '@/lib/lineup-integrity/lineupIntegrityService'
import type { LineupIntegrityEvidence, TankingEvidence } from '@/lib/integrity/TankingDetectionEngine'
import { lineupIntegrityPattern, percent } from '@/lib/integrity/lineupIntegrityScore'
import { tankingSeverity } from '@/lib/integrity/tankingRules'
import { normalizeSensitivity } from '@/lib/integrity/sensitivity'
import type { TeamLineupScores } from '@/lib/integrity/lineupIntegrityWeek'
import type { LineupCard } from '@/lib/integrity/nativeLineupCards'

/** Long enough to outlive any season; the row is a "this week was scanned" marker, not a lock. */
const SCANNED_MARKER_MS = 400 * 24 * 60 * 60 * 1000

/** Imported platforms the scan reads. The key keeps Sleeper's original shape, so no past week is rescanned. */
type ImportedTankingPlatform = 'sleeper' | 'espn'

export function importedTankingScanMarkerKey(leagueId: string, season: number, week: number, platform: ImportedTankingPlatform = 'sleeper'): string {
  return `integrity-tanking-scan:${leagueId}:${platform}:${season}:${week}`
}

const PROVIDER_NAME: Record<ImportedTankingPlatform, string> = { sleeper: 'Sleeper', espn: 'ESPN' }

type IntegritySettingsRow = {
  tankingMonitorEnabled: boolean
  tankingStartWeek: number | null
  tankingIllegalLineupCheck: boolean
  /** Gates the Lineup Integrity pattern (absent on older test doubles: treated as on, the column default). */
  tankingBenchPatternCheck?: boolean
  tankingSensitivity?: string | null
}

export type ImportedTankingScanDeps = {
  settings: (leagueId: string) => Promise<IntegritySettingsRow | null>
  entitled: (leagueId: string) => Promise<boolean>
  report: (leagueId: string) => Promise<LineupIntegrityReport | null>
  record: (leagueId: string) => Promise<Map<string, { wins: number; losses: number }>>
  claim: (key: string) => Promise<boolean>
  release: (key: string) => Promise<void>
  hasOpenCase: (leagueId: string, rosterId: string) => Promise<boolean>
  createFlag: (data: Prisma.IntegrityFlagUncheckedCreateInput) => Promise<{ id: string }>
  notify: (flagId: string) => Promise<unknown>
  stampScan: (leagueId: string) => Promise<unknown>
  /**
   * The Lineup Integrity score for the week (./sleeperLineupSnapshots.ts writes the kickoff snapshots):
   * each team's season of scores, keyed by Sleeper roster_id. Empty when no snapshot exists.
   */
  lineupScores?: (args: { leagueId: string; season: number; week: number }) => Promise<Map<string, TeamLineupScores>>
}

/**
 * The default `lineupScores`: Sleeper's recorded starters for the week, as lineup cards for the same week
 * scorer native leagues use (lib/integrity/lineupIntegrityWeek.ts), so both score the one way.
 */
async function defaultLineupScores(args: { leagueId: string; season: number; week: number }): Promise<Map<string, TeamLineupScores>> {
  const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { platformLeagueId: true, platform: true } })
  const { scoreLineupIntegrityWeek } = await import('@/lib/integrity/lineupIntegrityWeek')
  if (String(league?.platform ?? '').toLowerCase() === 'espn') {
    // ESPN: who started comes from the kickoff-locked capture (lib/integrity/espnStartersCapture.ts), and
    // only a team whose capture is complete gets a card — the rest are scored as "no lineup", not as 0%.
    const { readEspnWeekCards } = await import('@/lib/integrity/espnLineupSnapshots')
    const { cards, ended } = await readEspnWeekCards(args)
    if (!ended) return new Map()
    return scoreLineupIntegrityWeek({ leagueId: args.leagueId, season: args.season, week: args.week, cards })
  }
  if (!league?.platformLeagueId) return new Map()
  const rows = await prisma.leaguePlayerWeeklyScore.findMany({
    where: { leagueId: league.platformLeagueId, seasonYear: args.season, week: args.week, isStarter: true },
    select: { rosterId: true, playerId: true },
  })
  const cards = new Map<string, LineupCard>()
  for (const r of rows) {
    if (r.rosterId == null) continue
    const id = String(r.rosterId)
    const card = cards.get(id) ?? { rosterId: id, starters: [], bench: [] }
    card.starters.push({ playerId: r.playerId })
    cards.set(id, card)
  }
  return scoreLineupIntegrityWeek({ leagueId: args.leagueId, season: args.season, week: args.week, cards })
}

const defaultDeps: ImportedTankingScanDeps = {
  settings: (leagueId) =>
    prisma.leagueIntegritySettings.findUnique({
      where: { leagueId },
      select: { tankingMonitorEnabled: true, tankingStartWeek: true, tankingIllegalLineupCheck: true, tankingBenchPatternCheck: true, tankingSensitivity: true },
    }),
  entitled: checkLeagueCommissionerEntitlement,
  report: (leagueId) => readLineupIntegrity(leagueId, { fullSeason: false }),
  record: async (leagueId) => {
    const teams = await prisma.leagueTeam.findMany({ where: { leagueId }, select: { externalId: true, wins: true, losses: true } })
    return new Map(teams.map((t) => [String(t.externalId), { wins: t.wins, losses: t.losses }]))
  },
  claim: async (lockKey) => {
    try {
      await prisma.automationLock.create({
        data: { lockKey, owner: 'integrity-tanking-scan', expiresAt: new Date(Date.now() + SCANNED_MARKER_MS) },
      })
      return true
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false
      throw e
    }
  },
  release: async (lockKey) => {
    await prisma.automationLock.delete({ where: { lockKey } }).catch(() => undefined)
  },
  hasOpenCase: async (leagueId, rosterId) =>
    Boolean(
      await prisma.integrityFlag.findFirst({
        where: { leagueId, flagType: 'tanking', status: 'open', affectedRosterIds: { has: rosterId } },
        select: { id: true },
      }),
    ),
  createFlag: (data) => prisma.integrityFlag.create({ data, select: { id: true } }),
  notify: notifyCommissionerOfFlag,
  stampScan: (leagueId) =>
    prisma.leagueIntegritySettings.update({ where: { leagueId }, data: { lastTankingScanAt: new Date() } }),
  lineupScores: defaultLineupScores,
}

type ImportedTankingScanOutcome =
  | 'not_monitored'
  | 'not_entitled'
  | 'unsupported'
  | 'no_finished_week'
  | 'before_start_week'
  | 'already_scanned'
  | 'scanned'

/**
 * The tanking monitor for an IMPORTED Sleeper league — the same flag, the same commissioner alert and
 * the same "one open case per manager" rule a league run on AllFantasy gets when its week closes.
 *
 * What it reads is the lineup-integrity audit (lib/lineup-integrity/lineupIntegrityService.ts): the
 * starters Sleeper recorded for the latest FINISHED week, from `league_player_weekly_scores` rows the
 * results reconciler has sealed. DB-first: nothing here calls Sleeper. Only the audit's HARD evidence
 * opens a flag — an empty starting slot, or a starter whose NFL team was on bye. Its soft signal
 * ("scored 0 and is listed Out/IR today") is not a flag here either, because injury status is not
 * stored as it was at kickoff; it stays on the commissioner's lineup-integrity panel as a lead.
 *
 * Both hard signals are what the native scan calls an illegal lineup, so they obey the commissioner's
 * "illegal lineups" switch. The bench-pattern and waiver checks have nothing to read for an imported
 * league and are not run.
 *
 * ⚠ NO PENALTY, NO MANAGER WARNING. An imported league's managers and draft picks live on Sleeper, so
 * a confirmed case is the commissioner's to act on there (lib/integrity/tankingPenaltyService.ts
 * refuses non-native leagues). No model is asked either: both signals are facts, not judgements.
 *
 * ⚠ ONCE PER WEEK, BY MARKER, claimed before any flag is written and released if the scan throws, so a
 * dismissed flag is not re-opened by the next daily pass. Only the latest finished week is scanned:
 * turning the monitor on does not file a season's worth of old cases at once.
 */
export async function scanImportedLeagueForTanking(
  leagueId: string,
  deps: Partial<ImportedTankingScanDeps> = {},
): Promise<{ outcome: ImportedTankingScanOutcome; week?: number; flagged: number }> {
  const d = { ...defaultDeps, ...deps }
  const settings = await d.settings(leagueId)
  const illegalOn = settings?.tankingIllegalLineupCheck !== false
  const patternOn = settings?.tankingBenchPatternCheck !== false
  if (!settings?.tankingMonitorEnabled || (!illegalOn && !patternOn)) return { outcome: 'not_monitored', flagged: 0 }
  if (!(await d.entitled(leagueId).catch(() => false))) return { outcome: 'not_entitled', flagged: 0 }

  const report = await d.report(leagueId)
  if (!report || !report.supported) return { outcome: 'unsupported', flagged: 0 }
  const week = report.latestWeek
  if (week == null) return { outcome: 'no_finished_week', flagged: 0 }
  if (typeof settings.tankingStartWeek === 'number' && week < settings.tankingStartWeek) {
    return { outcome: 'before_start_week', week, flagged: 0 }
  }

  const platform: ImportedTankingPlatform = report.scoresSource === 'espn' ? 'espn' : 'sleeper'
  const key = importedTankingScanMarkerKey(leagueId, report.season, week, platform)
  if (!(await d.claim(key))) return { outcome: 'already_scanned', week, flagged: 0 }

  let flagged = 0
  try {
    const findings = illegalOn ? report.findings.filter((f) => f.flagged && f.week === week) : []
    /*
     * The Lineup Integrity score, from the kickoff snapshots: a PATTERN of weeks well under the best
     * available lineup, never one week. Scored on AllFantasy's projections under this league's scoring —
     * Sleeper's own projections are not stored — and the case says so.
     */
    const scores = patternOn && d.lineupScores ? await d.lineupScores({ leagueId, season: report.season, week }).catch(() => new Map<string, TeamLineupScores>()) : new Map<string, TeamLineupScores>()
    const sensitivity = normalizeSensitivity(settings.tankingSensitivity)
    const patterns = [...scores].flatMap(([rosterId, t]) => {
      if (!t.thisWeek?.scored) return []
      const p = lineupIntegrityPattern(t.weeks.map((w) => ({ week: w.week, ratio: w.ratio })), sensitivity)
      return p.pattern ? [{ rosterId, t, p }] : []
    })
    const records = findings.length || patterns.length ? await d.record(leagueId) : new Map<string, { wins: number; losses: number }>()
    for (const f of findings) {
      if (await d.hasOpenCase(leagueId, f.rosterId)) continue
      const name = (id: string) => f.playerNames[id] ?? id
      const evidence: TankingEvidence = {
        rosterId: f.rosterId,
        teamName: f.teamName,
        currentRecord: records.get(f.rosterId) ?? { wins: 0, losses: 0 },
        weekNumber: week,
        illegalOrSuspiciousStarters: [
          ...f.byeStarters.map((id) => ({ slotPosition: 'STARTER', startedPlayerId: id, startedPlayerName: name(id), startedPlayerStatus: 'BYE' })),
          ...Array.from({ length: f.emptySlots }, () => ({ slotPosition: 'STARTER', startedPlayerId: '', startedPlayerName: 'Empty slot', startedPlayerStatus: 'EMPTY' })),
        ],
        consecutiveWeeksWithSuspiciousLineup: 1,
        weeksFlagged: [week],
        pointsLeftOnBench: 0,
        eliminatedFromPlayoffs: false,
        weeksUntilPlayoffs: null,
        redFlags: [],
        detector: 'rules',
      }
      const row = await d.createFlag({
        leagueId,
        flagType: 'tanking',
        severity: 'medium',
        status: 'open',
        affectedRosterIds: [f.rosterId],
        affectedTeamNames: [f.teamName],
        summary: `${f.text} Recorded by Sleeper for a finished week; review it before acting.`,
        evidenceJson: evidence as unknown as Prisma.InputJsonValue,
        // Both signals are recorded facts, not a model's estimate.
        aiConfidence: 1,
      })
      flagged += 1
      await Promise.resolve(d.notify(row.id)).catch((err) => console.error('[integrity] imported tanking alert failed', { leagueId, err }))
    }
    const teamNames = new Map(report.findings.map((f) => [f.rosterId, f.teamName]))
    for (const { rosterId, t, p } of patterns) {
      // One open case per manager: a hard-evidence case opened above already covers this week.
      if (await d.hasOpenCase(leagueId, rosterId)) continue
      const teamName = teamNames.get(rosterId) ?? (await Promise.resolve()
          .then(() => prisma.leagueTeam.findFirst({ where: { leagueId, externalId: rosterId }, select: { teamName: true, ownerName: true } }))
          .then((x) => x?.teamName || x?.ownerName || null)
          .catch(() => null)) ?? 'A team'
      const lineupIntegrity: LineupIntegrityEvidence = { weeks: t.weeks, pattern: true, below: p.below, needed: p.needed, run: p.run, ownsOwnFirst: null, pickNote: null }
      const evidence: TankingEvidence = {
        rosterId,
        teamName,
        currentRecord: records.get(rosterId) ?? { wins: 0, losses: 0 },
        weekNumber: week,
        illegalOrSuspiciousStarters: [],
        consecutiveWeeksWithSuspiciousLineup: p.run.length,
        weeksFlagged: p.run,
        pointsLeftOnBench: 0,
        eliminatedFromPlayoffs: false,
        weeksUntilPlayoffs: null,
        redFlags: [`Scored with AllFantasy projections under this league’s scoring, as of each player’s kickoff. ${PROVIDER_NAME[platform]}’s own projections are not stored and may differ.`],
        detector: 'rules',
        lineupIntegrity,
      }
      const row = await d.createFlag({
        leagueId,
        flagType: 'tanking',
        severity: tankingSeverity({ suspiciousStarters: 0, consecutiveWeeks: p.run.length, eliminated: false }),
        status: 'open',
        affectedRosterIds: [rosterId],
        affectedTeamNames: [teamName],
        summary: `Started lineups well below the best available. Lineup Integrity under ${percent(p.below)}% of the best possible projection ${p.run.length} weeks in a row.`,
        evidenceJson: evidence as unknown as Prisma.InputJsonValue,
        aiConfidence: 0,
      })
      flagged += 1
      await Promise.resolve(d.notify(row.id)).catch((err) => console.error('[integrity] imported lineup-integrity alert failed', { leagueId, err }))
    }
    await d.stampScan(leagueId)
  } catch (error) {
    await d.release(key)
    throw error
  }
  return { outcome: 'scanned', week, flagged }
}

type ImportedTankingBatchResult = { discovered: number; scanned: number; flagged: number; failed: number }

/**
 * The daily pass (rides `/api/cron/commissioner-workspace-refresh`): every imported Sleeper league
 * whose commissioner switched the tanking monitor on. One league's failure never ends the batch.
 */
export async function scanImportedLeaguesForTanking(
  options: { limit?: number; leagueId?: string } = {},
  scanOne: typeof scanImportedLeagueForTanking = scanImportedLeagueForTanking,
): Promise<ImportedTankingBatchResult> {
  const rows = await prisma.leagueIntegritySettings.findMany({
    where: {
      tankingMonitorEnabled: true,
      ...(options.leagueId ? { leagueId: options.leagueId } : {}),
      league: { OR: [{ platform: { equals: 'sleeper', mode: 'insensitive' } }, { platform: { equals: 'espn', mode: 'insensitive' } }], platformLeagueId: { not: '' } },
    },
    select: { leagueId: true },
    orderBy: { lastTankingScanAt: { sort: 'asc', nulls: 'first' } },
    take: Math.min(200, Math.max(1, options.limit ?? 100)),
  })
  const out: ImportedTankingBatchResult = { discovered: rows.length, scanned: 0, flagged: 0, failed: 0 }
  for (const { leagueId } of rows) {
    try {
      const r = await scanOne(leagueId)
      if (r.outcome === 'scanned') out.scanned += 1
      out.flagged += r.flagged
    } catch (error) {
      out.failed += 1
      console.error('[integrity] imported tanking scan failed', { leagueId, error })
    }
  }
  return out
}

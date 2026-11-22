/**
 * Rookie contract assignment from draft slot (PROMPT 339). Deterministic only.
 * Uses SnakeSalaryScaleEngine for sport-aware, league-configurable salary assignment.
 *
 * Salary curve rules (adapted from contract-dynasty best practices):
 *   1.01 = highest salary (e.g., $45 for NFL)
 *   Decreasing by pick slot using configured curve (steep, linear, exponential, flat)
 *   Later rounds are cheaper — round 2+ picks cost progressively less
 *   Minimum salary floor enforced for all picks
 */

import { prisma } from '@/lib/prisma'
import { getSalaryCapConfig } from './SalaryCapLeagueConfig'
import { getSalaryForPick, getDefaultSnakeSalaryConfig, type SnakeSalaryScaleConfig } from './SnakeSalaryScaleEngine'

const DEFAULT_TEAM_COUNT = 12
const DEFAULT_DRAFT_ROUNDS = 15

/**
 * Load snake salary scale config for a league from DB.
 * Falls back to sport-aware defaults if no custom config is stored.
 */
async function getSnakeSalaryScaleConfig(
  leagueId: string,
  sport: string,
  teamCount: number,
  draftRounds: number
): Promise<SnakeSalaryScaleConfig> {
  try {
    const row = await prisma.$queryRaw<
      Array<{
        curveType: string
        totalCap: number
        maxSalary: number
        minSalary: number
        draftRounds: number
        teamCount: number
        contractYearsByRound: unknown
        customScale: unknown
      }>
    >`
      SELECT "curveType", "totalCap", "maxSalary", "minSalary", "draftRounds",
             "teamCount", "contractYearsByRound", "customScale"
      FROM "snake_salary_scale_configs"
      WHERE "leagueId" = ${leagueId}
      LIMIT 1
    `
    if (row.length > 0) {
      const r = row[0]
      const cyr =
        r.contractYearsByRound && typeof r.contractYearsByRound === 'object'
          ? (r.contractYearsByRound as Record<number, number>)
          : {}
      const cs =
        r.customScale && typeof r.customScale === 'object'
          ? (r.customScale as Record<number, number>)
          : undefined
      return {
        totalCap: Number(r.totalCap),
        teamCount: Number(r.teamCount) || teamCount,
        draftRounds: Number(r.draftRounds) || draftRounds,
        curveType: (r.curveType as SnakeSalaryScaleConfig['curveType']) ?? 'steep',
        minSalary: Number(r.minSalary),
        maxSalary: Number(r.maxSalary),
        contractYearsByRound: cyr,
        customScale: cs,
      }
    }
  } catch {
    // snake_salary_scale_configs table may not exist yet — fall through to defaults
  }
  return getDefaultSnakeSalaryConfig(sport, teamCount, draftRounds)
}

/** A rookie / snake-draft slot's contract: what `assignRookieContract` writes for that pick. */
export type RookieSlotTerms = { salary: number; years: number }

/**
 * The league's rookie-contract terms, loaded once: config, team count and salary scale. `termsFor`
 * is then pure, so the draft room can show every slot's salary and it is the SAME number the
 * contract is written with — both go through this function.
 *
 * Null when the league has no salary-cap config.
 */
export async function loadRookieContractTerms(
  leagueId: string,
): Promise<{
  configId: string
  teamCount: number
  startupDraftType: string
  termsFor: (draftSlot: number) => RookieSlotTerms
} | null> {
  const config = await getSalaryCapConfig(leagueId)
  if (!config) return null

  // Load league team count from leagueSettings or fall back to default
  let teamCount = DEFAULT_TEAM_COUNT
  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { leagueSize: true },
    })
    if (league?.leagueSize) teamCount = league.leagueSize
  } catch {
    // Use default
  }

  const scaleConfig = await getSnakeSalaryScaleConfig(
    leagueId,
    String(config.sport),
    teamCount,
    DEFAULT_DRAFT_ROUNDS
  )

  return {
    configId: config.configId,
    teamCount,
    startupDraftType: String(config.startupDraftType),
    termsFor: (draftSlot: number) => {
      const { salary, contractYears } = getSalaryForPick(draftSlot, scaleConfig)
      // Use league's rookieContractYears as authority over scale-derived years when configured
      const years = config.rookieContractYears > 0 ? config.rookieContractYears : contractYears
      // Enforce minimum salary from league config
      return { salary: Math.max(config.minimumSalary, Math.round(salary)), years }
    },
  }
}

/**
 * Assign rookie/snake-draft contract after draft pick.
 * Creates a PlayerContract with league-specific rookie years and slot salary
 * from the sport-aware snake salary scale.
 *
 * @param draftSlot - Overall pick number (1-based, e.g. 1.01 = slot 1)
 */
export async function assignRookieContract(
  leagueId: string,
  rosterId: string,
  playerId: string,
  playerName: string | null,
  position: string | null,
  draftSlot: number,
  capYear: number
): Promise<{ ok: boolean; contractId?: string; salary?: number; contractYears?: number; error?: string }> {
  const terms = await loadRookieContractTerms(leagueId)
  if (!terms) return { ok: false, error: 'Not a salary cap league' }
  const { salary: finalSalary, years } = terms.termsFor(draftSlot)
  const round = Math.ceil(draftSlot / terms.teamCount)

  const c = await prisma.playerContract.create({
    data: {
      leagueId,
      configId: terms.configId,
      rosterId,
      playerId,
      playerName,
      position,
      salary: finalSalary,
      yearsTotal: years,
      yearSigned: capYear,
      contractYear: 1,
      status: 'active',
      source: 'rookie_draft',
      /*
       * PlayerContract has no draftPickOverall / draftRound / contractSource columns. They were
       * spread in here behind `typeof prisma.playerContract.create === 'function'`, which is always
       * true, so Prisma rejected every rookie contract (#1928 → 2026-11). The pick goes in
       * `metadata`, the model's own place for it; `source` already says rookie_draft.
       */
      metadata: { draftPickOverall: draftSlot, draftRound: round },
    },
  })
  return { ok: true, contractId: c.id, salary: finalSalary, contractYears: years }
}

/**
 * The contract follows the pick. Until 2026-11 no rookie contract was ever written (see the create
 * above), so undo, reset and the commissioner pick editor never had one to clean up; once the write
 * works, a pick taken back would otherwise leave its salary counting against that team's cap.
 *
 * A pick's contract is found by league, team, player and `source: 'rookie_draft'`, plus the pick
 * number in `metadata`. The player is part of the key because a league's next rookie draft reuses
 * pick numbers. Contracts signed before this fix have no pick number and are never matched.
 */
type RookieContractDb = Pick<typeof prisma, 'playerContract'>
type RookiePickRef = { overall: number; rosterId: string | null; playerId: string | null }

/** The playerId a pick's contract is signed under — the pick's player, or a slot placeholder. */
export function rookieContractPlayerId(playerId: string | null | undefined, overall: number): string {
  const id = typeof playerId === 'string' ? playerId.trim() : ''
  return id || `draft-${overall}`
}

function rookieContractWhere(leagueId: string, pick: RookiePickRef) {
  return {
    leagueId,
    rosterId: pick.rosterId ?? '',
    playerId: rookieContractPlayerId(pick.playerId, pick.overall),
    source: 'rookie_draft',
    metadata: { path: ['draftPickOverall'], equals: pick.overall },
  }
}

/** Undo, reset, or the editor clearing / replacing a pick: its contract goes with it. */
export async function removeRookieDraftContract(db: RookieContractDb, leagueId: string, pick: RookiePickRef): Promise<number> {
  if (!pick.rosterId) return 0
  const res = await db.playerContract.deleteMany({ where: rookieContractWhere(leagueId, pick) })
  return res.count
}

/** The editor moving a made pick to another team: its contract moves with it. */
export async function moveRookieDraftContract(
  db: RookieContractDb,
  leagueId: string,
  pick: RookiePickRef,
  newRosterId: string,
): Promise<number> {
  if (!pick.rosterId) return 0
  const res = await db.playerContract.updateMany({ where: rookieContractWhere(leagueId, pick), data: { rosterId: newRosterId } })
  return res.count
}

/**
 * Sign a made pick's rookie contract when the league's startup draft is a snake — the gate
 * `submitPick` has always used. Null when the league does not sign rookie contracts. Callers run it
 * AFTER their pick is committed and treat a failure as non-fatal: a contract must never undo a pick.
 */
export async function signRookieContractForPick(input: {
  leagueId: string
  rosterId: string | null
  playerId: string | null
  playerName: string
  position: string | null
  overall: number
}): Promise<Awaited<ReturnType<typeof assignRookieContract>> | null> {
  if (!input.rosterId) return null
  const capConfig = await getSalaryCapConfig(input.leagueId)
  if (capConfig?.startupDraftType !== 'snake') return null
  return assignRookieContract(
    input.leagueId,
    input.rosterId,
    rookieContractPlayerId(input.playerId, input.overall),
    input.playerName.trim(),
    input.position,
    input.overall,
    new Date().getFullYear(),
  )
}

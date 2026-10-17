/**
 * The Salary Cap commish editor's rules: what a commish may change on `SalaryCapLeagueConfig`, the
 * allowed ranges, and the cross-field checks. Pure — the handler is
 * app/api/leagues/[leagueId]/specialty-settings/handler.ts.
 *
 * Only settings the cap engine actually READS are editable. Left out on purpose:
 *   - `mode` (dynasty / best ball) — it shapes the whole league and is set at creation.
 *   - `rookieOptionEnabled` — nothing in lib/salary-cap reads it, so a toggle would be a save that
 *     changes nothing.
 *   - `compPickEnabled` — CompPickService needs a `compPickFormula` too, which has no editor.
 *   - `offseasonPhase` — moved by the offseason routes, never by a settings form.
 *
 * ⚠ THE STARTUP DRAFT IS FROZEN ONCE IT HAS HAPPENED. When any contract exists, `startupDraftType`
 * and `auctionHoldback` describe a draft that is already over; changing them would rewrite history,
 * so they are refused rather than silently ignored.
 */
import type { SalaryCapConfig } from './types'

export const SALARY_CAP_STARTUP_DRAFT_TYPES = ['auction', 'snake'] as const
export const SALARY_CAP_FUTURE_DRAFT_TYPES = ['snake', 'auction', 'weighted_lottery'] as const

export const SALARY_CAP_LIMITS = {
  startupCap: [50, 1000],
  capGrowthPercent: [0, 25],
  contractMinYears: [1, 5],
  contractMaxYears: [1, 10],
  rookieContractYears: [1, 5],
  minimumSalary: [0, 50],
  deadMoneyPercentPerYear: [0, 100],
  rolloverMax: [0, 100],
} as const

/** What the editor shows and saves. Mirrors the editable subset of `SalaryCapConfig`. */
export type SalaryCapSettingsValue = {
  mode: string
  startupCap: number
  capGrowthPercent: number
  capFloorEnabled: boolean
  capFloorAmount: number | null
  contractMinYears: number
  contractMaxYears: number
  rookieContractYears: number
  minimumSalary: number
  deadMoneyEnabled: boolean
  deadMoneyPercentPerYear: number
  rolloverEnabled: boolean
  rolloverMax: number
  extensionsEnabled: boolean
  franchiseTagEnabled: boolean
  startupDraftType: (typeof SALARY_CAP_STARTUP_DRAFT_TYPES)[number]
  auctionHoldback: number
  futureDraftType: (typeof SALARY_CAP_FUTURE_DRAFT_TYPES)[number]
}

export type SalaryCapSettingsPatch = Partial<Omit<SalaryCapSettingsValue, 'mode'>> & {
  /** Kept in step with `futureDraftType`; the summary reads it to show the lottery. */
  weightedLotteryEnabled?: boolean
}

export function salaryCapSettingsValue(config: SalaryCapConfig): SalaryCapSettingsValue {
  return {
    mode: config.mode,
    startupCap: config.startupCap,
    capGrowthPercent: config.capGrowthPercent,
    capFloorEnabled: config.capFloorEnabled,
    capFloorAmount: config.capFloorAmount ?? null,
    contractMinYears: config.contractMinYears,
    contractMaxYears: config.contractMaxYears,
    rookieContractYears: config.rookieContractYears,
    minimumSalary: config.minimumSalary,
    deadMoneyEnabled: config.deadMoneyEnabled,
    deadMoneyPercentPerYear: config.deadMoneyPercentPerYear,
    rolloverEnabled: config.rolloverEnabled,
    rolloverMax: config.rolloverMax,
    extensionsEnabled: config.extensionsEnabled,
    franchiseTagEnabled: config.franchiseTagEnabled,
    startupDraftType: config.startupDraftType,
    auctionHoldback: config.auctionHoldback,
    futureDraftType: config.futureDraftType === 'weighted_lottery' || config.futureDraftType === 'auction' ? config.futureDraftType : 'snake',
  }
}

type Parsed = { ok: true; patch: SalaryCapSettingsPatch } | { ok: false; error: string }

/**
 * Validate a patch against the league's current settings. Cross-field rules are checked on the
 * MERGED result, so a patch that only moves one side of a pair (min/max years, cap/floor) is judged
 * against the other side's saved value.
 */
export function parseSalaryCapSettingsPatch(
  raw: Record<string, unknown>,
  current: SalaryCapSettingsValue,
  opts: { startupLocked: boolean },
): Parsed {
  const patch: SalaryCapSettingsPatch = {}
  const fail = (error: string): Parsed => ({ ok: false, error })

  if (raw.mode !== undefined && raw.mode !== current.mode) {
    return fail('The cap mode is set when the league is created and cannot be changed.')
  }

  for (const key of Object.keys(SALARY_CAP_LIMITS) as (keyof typeof SALARY_CAP_LIMITS)[]) {
    if (raw[key] === undefined) continue
    const [min, max] = SALARY_CAP_LIMITS[key]
    const n = Number(raw[key])
    // Cap growth may be a half percent; everything else is a whole number.
    const stepOk = key === 'capGrowthPercent' ? Number.isInteger(n * 2) : Number.isInteger(n)
    if (typeof raw[key] === 'boolean' || !Number.isFinite(n) || !stepOk || n < min || n > max) {
      return fail(
        key === 'capGrowthPercent'
          ? `${key} must be from ${min} to ${max} in steps of 0.5`
          : `${key} must be a whole number from ${min} to ${max}`,
      )
    }
    patch[key] = n
  }

  for (const key of ['capFloorEnabled', 'deadMoneyEnabled', 'rolloverEnabled', 'extensionsEnabled', 'franchiseTagEnabled'] as const) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'boolean') return fail(`${key} must be true or false`)
    patch[key] = raw[key] as boolean
  }

  if (raw.capFloorAmount !== undefined) {
    if (raw.capFloorAmount === null) patch.capFloorAmount = null
    else {
      const n = Number(raw.capFloorAmount)
      if (typeof raw.capFloorAmount === 'boolean' || !Number.isInteger(n) || n < 0) {
        return fail('capFloorAmount must be a whole number of 0 or more')
      }
      patch.capFloorAmount = n
    }
  }

  if (raw.futureDraftType !== undefined) {
    if (!(SALARY_CAP_FUTURE_DRAFT_TYPES as readonly unknown[]).includes(raw.futureDraftType)) {
      return fail(`futureDraftType must be one of: ${SALARY_CAP_FUTURE_DRAFT_TYPES.join(', ')}`)
    }
    patch.futureDraftType = raw.futureDraftType as SalaryCapSettingsValue['futureDraftType']
    patch.weightedLotteryEnabled = patch.futureDraftType === 'weighted_lottery'
  }

  if (raw.startupDraftType !== undefined && raw.startupDraftType !== current.startupDraftType) {
    if (!(SALARY_CAP_STARTUP_DRAFT_TYPES as readonly unknown[]).includes(raw.startupDraftType)) {
      return fail(`startupDraftType must be one of: ${SALARY_CAP_STARTUP_DRAFT_TYPES.join(', ')}`)
    }
    if (opts.startupLocked) return fail('The startup draft has already happened, so its type cannot change.')
    patch.startupDraftType = raw.startupDraftType as SalaryCapSettingsValue['startupDraftType']
  }

  if (raw.auctionHoldback !== undefined && Number(raw.auctionHoldback) !== current.auctionHoldback) {
    const n = Number(raw.auctionHoldback)
    if (typeof raw.auctionHoldback === 'boolean' || !Number.isInteger(n) || n < 0) {
      return fail('auctionHoldback must be a whole number of 0 or more')
    }
    if (opts.startupLocked) return fail('The startup draft has already happened, so its holdback cannot change.')
    patch.auctionHoldback = n
  }

  const next = { ...current, ...patch }
  if (next.contractMinYears > next.contractMaxYears) {
    return fail('The shortest contract cannot be longer than the longest.')
  }
  if (next.minimumSalary >= next.startupCap) return fail('The minimum salary must be below the cap.')
  if (!opts.startupLocked && next.auctionHoldback >= next.startupCap) {
    return fail('The auction holdback must be below the cap.')
  }
  if (next.capFloorEnabled) {
    if (next.capFloorAmount == null) {
      // Turning the floor on with no amount yet: start it at 80% of the cap, a common league default.
      if (patch.capFloorEnabled === true) patch.capFloorAmount = Math.floor(next.startupCap * 0.8)
      else return fail('Set a cap floor amount.')
    } else if (next.capFloorAmount >= next.startupCap) {
      return fail('The cap floor must be below the cap.')
    }
  }
  return { ok: true, patch }
}

/** One team's cap position this cap year, as the editor's compliance check shows it. */
export type CapComplianceRow = {
  rosterId: string
  name: string
  cap: number
  capHit: number
  capSpace: number
  overCap: boolean
  belowFloor: boolean
}

export function capComplianceRow(input: {
  rosterId: string
  name: string
  cap: number
  totalCapHit: number
  deadMoneyHit: number
  floor: number | null
}): CapComplianceRow {
  const capHit = input.totalCapHit + input.deadMoneyHit
  return {
    rosterId: input.rosterId,
    name: input.name,
    cap: input.cap,
    capHit,
    capSpace: input.cap - capHit,
    overCap: capHit > input.cap,
    // Dead money counts toward the floor too, matching CapCalculationService.checkCapLegality.
    belowFloor: input.floor != null && capHit < input.floor,
  }
}

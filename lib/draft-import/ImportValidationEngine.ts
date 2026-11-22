/**
 * Validate mapped import preview (and optional raw payload). Deterministic, rules-based.
 */

import { MAX_NATIVE_TEAMS } from '@/lib/league/teamCountLimits'
import type { DraftImportPreview } from './DraftImportPreview'
import type { ImportErrorReport } from './types'
import { createEmptyReport, addError, addWarning } from './ImportErrorReport'

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function validatePreview(
  preview: DraftImportPreview,
  existingPickCount: number,
  sessionStatus: string
): ImportErrorReport {
  const report = createEmptyReport()
  const { slotOrder, picks, summary } = preview
  const teamCount = slotOrder.length
  const rounds = preview.metadata?.rounds ?? Math.max(1, ...picks.map((pick) => pick.round), 15)
  const maxOverall = teamCount * rounds

  if (teamCount < 1 || teamCount > MAX_NATIVE_TEAMS) {
    addError(report, 'INVALID_TEAM_COUNT', `teamCount must be 1–${MAX_NATIVE_TEAMS}, got ${teamCount}`, 'slotOrder')
  }
  if (rounds < 1 || rounds > 60) {
    addError(report, 'INVALID_ROUNDS', `rounds must be 1–60, got ${rounds}`, 'metadata.rounds')
  }
  if (preview.metadata?.teamCount && preview.metadata.teamCount !== teamCount) {
    addError(
      report,
      'TEAM_COUNT_MISMATCH',
      `metadata.teamCount (${preview.metadata.teamCount}) does not match resolved slot order length (${teamCount})`,
      'metadata.teamCount'
    )
  }
  if (summary.pickCount !== picks.length) {
    addError(report, 'SUMMARY_PICK_COUNT_MISMATCH', 'preview.summary.pickCount does not match picks.length', 'summary.pickCount')
  }

  const slotNumbers = new Set<number>()
  const slotRosterIds = new Set<string>()
  for (let i = 0; i < slotOrder.length; i += 1) {
    const slot = slotOrder[i]
    if (!Number.isInteger(slot.slot) || slot.slot < 1 || slot.slot > teamCount) {
      addError(report, 'INVALID_SLOT_ORDER_SLOT', `slotOrder[${i}] has invalid slot ${slot.slot}`, `slotOrder[${i}].slot`)
    }
    if (slotNumbers.has(slot.slot)) {
      addError(report, 'DUPLICATE_SLOT_ORDER_SLOT', `slot ${slot.slot} appears more than once in slotOrder`, `slotOrder[${i}].slot`)
    }
    slotNumbers.add(slot.slot)
    if (!slot.rosterId || !slot.rosterId.trim()) {
      addError(report, 'MISSING_SLOT_ORDER_ROSTER_ID', `slotOrder[${i}] is missing rosterId`, `slotOrder[${i}].rosterId`)
      continue
    }
    if (slotRosterIds.has(slot.rosterId)) {
      addError(report, 'DUPLICATE_SLOT_ORDER_ROSTER_ID', `rosterId "${slot.rosterId}" appears more than once in slotOrder`, `slotOrder[${i}].rosterId`)
    }
    slotRosterIds.add(slot.rosterId)
  }

  const overalls = new Set<number>()
  const playerNamesByRoster = new Map<string, Set<string>>()
  const playerNamesGlobal = new Set<string>()
  for (const p of picks) {
    if (!Number.isInteger(p.overall) || !Number.isInteger(p.round) || !Number.isInteger(p.slot)) {
      addError(report, 'INVALID_PICK_NUMBER', `Pick "${p.playerName}" has non-integer overall/round/slot`, 'picks')
      continue
    }
    if (p.overall < 1 || p.overall > maxOverall) {
      addError(report, 'OVERALL_OUT_OF_RANGE', `Pick overall ${p.overall} is outside 1–${maxOverall}`, `picks.overall`)
    }
    if (p.round < 1 || p.round > rounds) {
      addError(report, 'ROUND_OUT_OF_RANGE', `Pick overall ${p.overall} round ${p.round} is outside 1–${rounds}`, `picks[${p.overall}].round`)
    }
    if (p.slot < 1 || p.slot > teamCount) {
      addError(report, 'SLOT_OUT_OF_RANGE', `Pick overall ${p.overall} slot ${p.slot} is outside 1–${teamCount}`, `picks[${p.overall}].slot`)
    }
    const expectedOverall = (p.round - 1) * teamCount + p.slot
    if (expectedOverall !== p.overall) {
      addError(
        report,
        'OVERALL_SLOT_ROUND_MISMATCH',
        `Pick "${p.playerName}" has overall ${p.overall} but round/slot implies ${expectedOverall}`,
        `picks[${p.overall}]`
      )
    }
    if (overalls.has(p.overall)) {
      addError(report, 'DUPLICATE_OVERALL', `Duplicate overall pick number ${p.overall}`, `picks`)
    }
    overalls.add(p.overall)
    if (!slotOrder.some((s) => s.rosterId === p.rosterId)) {
      addWarning(report, 'ROSTER_NOT_IN_ORDER', `Pick #${p.overall} rosterId "${p.rosterId}" not in draft order`, `picks[${p.overall}]`)
    }
    const playerName = normalizeName(p.playerName ?? '')
    const key = `${p.rosterId}:${playerName}`
    const rosterSet = playerNamesByRoster.get(p.rosterId) ?? new Set()
    if (rosterSet.has(key)) {
      addError(report, 'DUPLICATE_PLAYER', `Duplicate player "${p.playerName}" for same roster`, `picks[${p.overall}]`)
    }
    rosterSet.add(key)
    playerNamesByRoster.set(p.rosterId, rosterSet)
    if (playerNamesGlobal.has(playerName)) {
      addWarning(report, 'PLAYER_SELECTED_MULTIPLE_TIMES', `Player "${p.playerName}" appears in multiple picks`, `picks[${p.overall}]`)
    } else {
      playerNamesGlobal.add(playerName)
    }
  }

  if (preview.tradedPicks?.length) {
    const tradedPickKeys = new Set<string>()
    for (let i = 0; i < preview.tradedPicks.length; i += 1) {
      const traded = preview.tradedPicks[i]
      if (traded.round < 1 || traded.round > rounds) {
        addError(
          report,
          'TRADED_PICK_ROUND_OUT_OF_RANGE',
          `Traded pick round ${traded.round} is outside 1–${rounds}`,
          `tradedPicks[${i}].round`
        )
      }
      if (!slotRosterIds.has(traded.originalRosterId) || !slotRosterIds.has(traded.newRosterId)) {
        addWarning(
          report,
          'TRADED_PICK_ROSTER_NOT_IN_ORDER',
          `Traded pick round ${traded.round} has roster ids not present in slot order`,
          `tradedPicks[${i}]`
        )
      }
      const tradedKey = `${traded.round}:${traded.originalRosterId}`
      if (tradedPickKeys.has(tradedKey)) {
        addError(
          report,
          'DUPLICATE_TRADED_PICK',
          `Duplicate traded pick for round ${traded.round} and original roster ${traded.originalRosterId}`,
          `tradedPicks[${i}]`
        )
      }
      tradedPickKeys.add(tradedKey)
    }
  }

  if (sessionStatus !== 'pre_draft' && existingPickCount > 0) {
    addWarning(report, 'IMPORT_OVERWRITES', `Session has ${existingPickCount} existing picks; import will replace draft state.`, 'session')
  }

  if (preview.keeperSelections?.length && !preview.keeperConfig?.maxKeepers) {
    addWarning(report, 'KEEPER_CONFIG_MISSING', 'Keeper selections present but keeper config missing; config may be ignored.', 'keeperConfig')
  }
  if (preview.keeperConfig?.maxKeepers != null) {
    if (preview.keeperConfig.maxKeepers < 0 || preview.keeperConfig.maxKeepers > 50) {
      addError(
        report,
        'KEEPER_MAX_OUT_OF_RANGE',
        `keeperConfig.maxKeepers must be 0–50, got ${preview.keeperConfig.maxKeepers}`,
        'keeperConfig.maxKeepers'
      )
    }
  }
  if (preview.keeperSelections?.length) {
    const keeperKeys = new Set<string>()
    for (let i = 0; i < preview.keeperSelections.length; i += 1) {
      const keeper = preview.keeperSelections[i]
      if (keeper.roundCost < 1 || keeper.roundCost > rounds) {
        addError(
          report,
          'KEEPER_ROUND_COST_OUT_OF_RANGE',
          `Keeper "${keeper.playerName}" roundCost ${keeper.roundCost} is outside 1–${rounds}`,
          `keeperSelections[${i}].roundCost`
        )
      }
      if (!slotRosterIds.has(keeper.rosterId)) {
        addWarning(
          report,
          'KEEPER_ROSTER_NOT_IN_ORDER',
          `Keeper "${keeper.playerName}" rosterId "${keeper.rosterId}" not found in slot order`,
          `keeperSelections[${i}]`
        )
      }
      const keeperKey = `${keeper.rosterId}:${normalizeName(keeper.playerName ?? '')}`
      if (keeperKeys.has(keeperKey)) {
        addError(
          report,
          'DUPLICATE_KEEPER_SELECTION',
          `Duplicate keeper selection "${keeper.playerName}" for the same roster`,
          `keeperSelections[${i}]`
        )
      }
      keeperKeys.add(keeperKey)
    }
  }

  return report
}

/**
 * Validate raw payload structure (before mapping). Catches obvious format errors.
 */
export function validateRawPayload(payload: unknown): ImportErrorReport {
  const report = createEmptyReport()
  if (payload == null || typeof payload !== 'object') {
    addError(report, 'INVALID_PAYLOAD', 'Payload must be a JSON object')
    return report
  }
  const raw = payload as Record<string, unknown>
  if (raw.picks != null && !Array.isArray(raw.picks)) {
    addError(report, 'INVALID_PICKS', 'picks must be an array', 'picks')
  }
  if (raw.draftOrder != null && !Array.isArray(raw.draftOrder)) {
    addError(report, 'INVALID_DRAFT_ORDER', 'draftOrder must be an array', 'draftOrder')
  }
  if (raw.tradedPicks != null && !Array.isArray(raw.tradedPicks)) {
    addError(report, 'INVALID_TRADED_PICKS', 'tradedPicks must be an array', 'tradedPicks')
  }
  if (raw.keeperSelections != null && !Array.isArray(raw.keeperSelections)) {
    addError(report, 'INVALID_KEEPER_SELECTIONS', 'keeperSelections must be an array', 'keeperSelections')
  }
  if (raw.keeperConfig != null && typeof raw.keeperConfig !== 'object') {
    addError(report, 'INVALID_KEEPER_CONFIG', 'keeperConfig must be an object', 'keeperConfig')
  }
  if (raw.metadata != null && typeof raw.metadata !== 'object') {
    addError(report, 'INVALID_METADATA', 'metadata must be an object', 'metadata')
  }
  const hasImportData = Boolean(
    (Array.isArray(raw.picks) && raw.picks.length > 0) ||
      (Array.isArray(raw.draftOrder) && raw.draftOrder.length > 0) ||
      (Array.isArray(raw.tradedPicks) && raw.tradedPicks.length > 0) ||
      raw.keeperConfig ||
      (Array.isArray(raw.keeperSelections) && raw.keeperSelections.length > 0) ||
      raw.metadata
  )
  if (!hasImportData) {
    addError(
      report,
      'EMPTY_IMPORT_PAYLOAD',
      'Payload must include at least one of: draftOrder, picks, tradedPicks, keeperConfig, keeperSelections, metadata'
    )
  }
  return report
}

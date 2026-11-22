/**
 * Draft import service: parse payload, map, validate, produce preview + error report.
 * Deterministic; no AI. Sport-aware (NFL, NHL, NBA, MLB, NCAAB, NCAAF, Soccer).
 */

import type { RawDraftImportPayload } from './types'
import type { DraftImportPreview } from './DraftImportPreview'
import type { ImportErrorReport } from './types'
import type { LeagueImportContext } from './ImportMappingLayer'
import { mapPayloadToPreview } from './ImportMappingLayer'
import { validateRawPayload, validatePreview } from './ImportValidationEngine'
import { mergeReports } from './ImportErrorReport'
import { createEmptyPreview } from './DraftImportPreview'

interface DraftImportResult {
  preview: DraftImportPreview
  report: ImportErrorReport
  /** True if dry-run passed (no blocking errors). */
  valid: boolean
}

/**
 * Run dry-run import: parse, map, validate. Does not write to DB.
 */
export function runDraftImportDryRun(
  payload: RawDraftImportPayload,
  ctx: LeagueImportContext,
  options: { existingPickCount?: number; sessionStatus?: string } = {}
): DraftImportResult {
  const existingPickCount = options.existingPickCount ?? 0
  const sessionStatus = options.sessionStatus ?? 'pre_draft'
  const normalizedPayload = normalizePayloadShape(payload)

  const rawReport = validateRawPayload(normalizedPayload)
  if (!rawReport.canProceed) {
    const emptyPreview = createEmptyPreview(ctx.teamCount, ctx.rounds)
    return {
      preview: emptyPreview,
      report: rawReport,
      valid: false,
    }
  }

  const { preview, report: mapReport } = mapPayloadToPreview(normalizedPayload, ctx)
  const validationReport = validatePreview(preview, existingPickCount, sessionStatus)
  mergeReports(mapReport, validationReport)

  return {
    preview: mapReport.canProceed ? preview : { ...preview, picks: [], tradedPicks: [], keeperSelections: [] },
    report: mapReport,
    valid: mapReport.canProceed,
  }
}

/**
 * Parse JSON string or object into RawDraftImportPayload. Returns null and sets parseError if invalid.
 */
export function parseImportPayload(
  input: string | object
): { payload: RawDraftImportPayload; parseError?: string } {
  if (typeof input === 'object' && input !== null) {
    return { payload: normalizePayloadShape(input as RawDraftImportPayload) }
  }
  if (typeof input !== 'string') return { payload: {} as RawDraftImportPayload, parseError: 'Invalid input type' }
  try {
    const parsed = JSON.parse(input) as unknown
    if (parsed != null && typeof parsed === 'object') {
      return { payload: normalizePayloadShape(parsed as RawDraftImportPayload) }
    }
    return { payload: {} as RawDraftImportPayload, parseError: 'Parsed result is not an object' }
  } catch (e) {
    return { payload: {} as RawDraftImportPayload, parseError: (e as Error).message }
  }
}

function normalizePayloadShape(payload: RawDraftImportPayload): RawDraftImportPayload {
  const anyPayload = payload as Record<string, unknown>
  const source = typeof anyPayload.source === 'string' ? anyPayload.source : undefined

  const draftOrder =
    (Array.isArray(anyPayload.draftOrder) && anyPayload.draftOrder) ||
    (Array.isArray(anyPayload.draft_order) && anyPayload.draft_order) ||
    (Array.isArray(anyPayload.order) && anyPayload.order) ||
    undefined

  const picks =
    (Array.isArray(anyPayload.picks) && anyPayload.picks) ||
    (Array.isArray(anyPayload.completedPicks) && anyPayload.completedPicks) ||
    (Array.isArray(anyPayload.completed_picks) && anyPayload.completed_picks) ||
    undefined

  const tradedPicks =
    (Array.isArray(anyPayload.tradedPicks) && anyPayload.tradedPicks) ||
    (Array.isArray(anyPayload.traded_picks) && anyPayload.traded_picks) ||
    (Array.isArray(anyPayload.pickOwnership) && anyPayload.pickOwnership) ||
    undefined

  const keeperConfig =
    (anyPayload.keeperConfig && typeof anyPayload.keeperConfig === 'object' && anyPayload.keeperConfig) ||
    (anyPayload.keepers && typeof anyPayload.keepers === 'object' && anyPayload.keepers) ||
    undefined

  const keeperSelections =
    (Array.isArray(anyPayload.keeperSelections) && anyPayload.keeperSelections) ||
    (Array.isArray(anyPayload.keeper_selections) && anyPayload.keeper_selections) ||
    (Array.isArray(anyPayload.keepersSelected) && anyPayload.keepersSelected) ||
    undefined

  const metadata =
    (anyPayload.metadata && typeof anyPayload.metadata === 'object' && anyPayload.metadata) ||
    (anyPayload.leagueMetadata && typeof anyPayload.leagueMetadata === 'object' && anyPayload.leagueMetadata) ||
    undefined

  return {
    source: (source as RawDraftImportPayload['source']) ?? 'generic',
    draftOrder: draftOrder as RawDraftImportPayload['draftOrder'],
    picks: picks as RawDraftImportPayload['picks'],
    tradedPicks: tradedPicks as RawDraftImportPayload['tradedPicks'],
    keeperConfig: keeperConfig as RawDraftImportPayload['keeperConfig'],
    keeperSelections: keeperSelections as RawDraftImportPayload['keeperSelections'],
    metadata: metadata as RawDraftImportPayload['metadata'],
  }
}

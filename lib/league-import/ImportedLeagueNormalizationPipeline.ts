/**
 * Provider-aware pipeline: fetch provider payload, then normalize to AF canonical shape.
 * String input remains backward compatible for legacy Sleeper-only call sites.
 */

import { fetchSleeperLeagueForImport } from './sleeper/SleeperLeagueFetchService'
import {
  EspnImportConnectionError,
  EspnImportLeagueNotFoundError,
  fetchEspnLeagueForImport,
} from './espn/EspnLeagueFetchService'
import {
  fetchYahooLeagueForImport,
  YahooApiResponseError,
  YahooImportConnectionError,
  YahooImportLeagueNotFoundError,
} from './yahoo/YahooLeagueFetchService'
import { describeYahooRejection } from './yahoo/yahooRejection'
import {
  fetchMflLeagueForImport,
  MflImportConnectionError,
  MflImportLeagueNotFoundError,
} from './mfl/MflLeagueFetchService'
import {
  fetchFantraxLeagueForImport,
  FantraxImportConnectionError,
  FantraxImportLeagueNotFoundError,
} from './fantrax/FantraxLeagueFetchService'
import {
  fetchFleaflickerLeagueForImport,
  FleaflickerImportLeagueNotFoundError,
} from './fleaflicker/FleaflickerLeagueFetchService'
import { runImportNormalizationPipeline } from './ImportNormalizationPipeline'
import type { ImportProvider, NormalizedImportResult } from './types'

export interface ImportedLeagueNormalizationInput {
  provider: ImportProvider
  sourceId: string
  userId?: string
}

export interface ImportedLeagueNormalizationResult {
  success: true
  normalized: NormalizedImportResult
  /**
   * The raw, provider-native payload this normalization was built from (e.g. a
   * `SleeperImportPayload` for Sleeper). Already fetched once here — exposed so
   * downstream Sleeper-specific validation (SleeperImportValidation) can read
   * it without a second, wasteful, potentially-inconsistent fetch. `unknown`
   * because its real shape is provider-specific; callers narrow it themselves
   * after checking `normalized.source.source_provider`.
   */
  rawPayload?: unknown
}

export interface ImportedLeagueNormalizationError {
  success: false
  error: string
  code: 'LEAGUE_NOT_FOUND' | 'NORMALIZATION_FAILED' | 'CONNECTION_REQUIRED' | 'UNAUTHORIZED'
}

/**
 * Fetch provider payload by source ID and normalize to NormalizedImportResult.
 */
export async function runImportedLeagueNormalizationPipeline(
  input: string | ImportedLeagueNormalizationInput
): Promise<ImportedLeagueNormalizationResult | ImportedLeagueNormalizationError> {
  const provider = typeof input === 'string' ? 'sleeper' : input.provider
  const sourceId = typeof input === 'string' ? input : input.sourceId

  try {
    let payload: unknown

    if (provider === 'sleeper') {
      payload = await fetchSleeperLeagueForImport(sourceId)
      if (!(payload as any)?.league?.league_id) {
        return {
          success: false,
          error: 'League not found. Please check your League ID.',
          code: 'LEAGUE_NOT_FOUND',
        }
      }
    } else if (provider === 'yahoo') {
      if (typeof input === 'string' || !input.userId) {
        return {
          success: false,
          error: 'Sign in and connect Yahoo before importing from Yahoo.',
          code: 'UNAUTHORIZED',
        }
      }
      payload = await fetchYahooLeagueForImport(input.userId, sourceId)
    } else if (provider === 'espn') {
      if (typeof input === 'string' || !input.userId) {
        return {
          success: false,
          error: 'Sign in before importing from ESPN.',
          code: 'UNAUTHORIZED',
        }
      }
      payload = await fetchEspnLeagueForImport(input.userId, sourceId)
    } else if (provider === 'mfl') {
      if (typeof input === 'string' || !input.userId) {
        return {
          success: false,
          error: 'Sign in before importing from MyFantasyLeague.',
          code: 'UNAUTHORIZED',
        }
      }
      payload = await fetchMflLeagueForImport(input.userId, sourceId)
    } else if (provider === 'fantrax') {
      if (typeof input === 'string' || !input.userId) {
        return {
          success: false,
          error: 'Sign in before importing from Fantrax.',
          code: 'UNAUTHORIZED',
        }
      }
      payload = await fetchFantraxLeagueForImport(input.userId, sourceId)
    } else if (provider === 'fleaflicker') {
      /** Public JSON API — no OAuth; optional `userId` ignored for fetch. */
      payload = await fetchFleaflickerLeagueForImport(sourceId)
    } else {
      return {
        success: false,
        error: `Import from ${provider} is not yet available.`,
        code: 'NORMALIZATION_FAILED',
      }
    }

    const normalized = await runImportNormalizationPipeline({
      provider,
      raw: payload,
    })
    return { success: true, normalized, rawPayload: payload }
  } catch (e) {
    if (e instanceof EspnImportConnectionError) {
      return { success: false, error: e.message, code: 'CONNECTION_REQUIRED' }
    }
    if (e instanceof EspnImportLeagueNotFoundError) {
      return { success: false, error: e.message, code: 'LEAGUE_NOT_FOUND' }
    }
    if (e instanceof YahooImportConnectionError) {
      return { success: false, error: e.message, code: 'CONNECTION_REQUIRED' }
    }
    if (e instanceof YahooImportLeagueNotFoundError) {
      return { success: false, error: e.message, code: 'LEAGUE_NOT_FOUND' }
    }
    /*
     * ⚠ WITHOUT THIS, YAHOO'S RAW JSON REACHED THE SCREEN. The message on a
     * YahooApiResponseError is the provider's response body, and the generic
     * handler below returns `e.message` verbatim — so an import attempt rendered
     * `{"error":{"xml:lang":"en-us","yahoo:uri":"/fantasy/v2/league/…"}}` to the
     * user, publishing our own API path and explaining nothing. Observed on the
     * first real use of the league-ID fallback.
     */
    if (e instanceof YahooApiResponseError) {
      /*
       * Mapped onto the existing codes rather than widening the union: 401 and
       * 403 are both "this connection cannot do it as it stands", 404 is a league
       * that is not there, and anything else keeps the generic code it already
       * fell through to. Only the message changes for that last group.
       */
      return {
        success: false,
        error: describeYahooRejection(e.status),
        code:
          e.status === 404
            ? 'LEAGUE_NOT_FOUND'
            : e.status === 401 || e.status === 403
              ? 'CONNECTION_REQUIRED'
              : 'NORMALIZATION_FAILED',
      }
    }
    if (e instanceof MflImportConnectionError) {
      return { success: false, error: e.message, code: 'CONNECTION_REQUIRED' }
    }
    if (e instanceof MflImportLeagueNotFoundError) {
      return { success: false, error: e.message, code: 'LEAGUE_NOT_FOUND' }
    }
    if (e instanceof FantraxImportConnectionError) {
      return { success: false, error: e.message, code: 'CONNECTION_REQUIRED' }
    }
    if (e instanceof FantraxImportLeagueNotFoundError) {
      return { success: false, error: e.message, code: 'LEAGUE_NOT_FOUND' }
    }
    if (e instanceof FleaflickerImportLeagueNotFoundError) {
      return { success: false, error: e.message, code: 'LEAGUE_NOT_FOUND' }
    }
    const message = e instanceof Error ? e.message : 'Import normalization failed'
    return { success: false, error: message, code: 'NORMALIZATION_FAILED' }
  }
}

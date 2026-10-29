import { ingestProFantraxIdentities } from './ingestProFantraxIdentities'

/**
 * Scheduled ingestion only. One provider read, one registry read and a guarded batch update.
 * Generalised in `ingestProFantraxIdentities.ts`; the MLB marker key, cadence and SQL are unchanged.
 */
export function ingestMlbFantraxIdentities(dryRun = false) {
  return ingestProFantraxIdentities('MLB', dryRun)
}

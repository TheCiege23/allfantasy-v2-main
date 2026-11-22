/**
 * League-engine job catalog: kinds, recommended BullMQ options, retry/dead-letter guidance.
 * Enqueue via `enqueueLeagueEngineJob` + `LeagueEngineJobPayload` in `lib/jobs/types.ts`.
 */

/** Default BullMQ options for durable league-engine work (tune per deployment). */
export const DEFAULT_LEAGUE_ENGINE_QUEUE_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2500 },
  removeOnComplete: 200,
  removeOnFail: 1000,
} as const

/**
 * Jobs that should use the **AI** queue (`enqueueAi`), not `LEAGUE_ENGINE`:
 * - matchup explanation, start/sit synthesis — use `buildAiMatchupRefreshEnqueueKey` as `jobId` when enqueueing.
 * - trade/waiver AI analysis — dedupe by league + proposal/claim id.
 *
 * Jobs that should use **notifications** queue:
 * - bulk PlatformNotification dispatch — `enqueueNotification` with stable `jobId` from dedupe keys.
 */


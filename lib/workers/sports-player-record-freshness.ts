import type { SupportedSport } from '@/lib/sport-scope'

/**
 * How long a `sports_players` row stays current after the importer writes it. The importer's
 * failure path relabels rows older than this as `cached`, and its injury cleanup clears them.
 *
 * Lives in its own module so a READER (`lib/data/players.ts`) can apply the same window without
 * importing the importer — several suites mock that module with only `runSportsDataImporter`, and a
 * mocked module throws on any other export a reader touches.
 */
export const SPORTS_PLAYER_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Sports the importer writes ONE PAGE of per run (NCAAF 62,751 / NCAAB 18,209 identity rows cannot
 * be written whole inside a run). A row on a page the rotation has not reached yet is days old and
 * still current, so "older than the TTL" means nothing about it — readers must not treat age as
 * orphan-hood for these sports.
 */
export const COLLEGE_PAGED_SPORTS: ReadonlySet<SupportedSport> = new Set<SupportedSport>(['NCAAF', 'NCAAB'] as SupportedSport[])

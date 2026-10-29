/**
 * Kill switches for the change-aware sync writers.
 *
 * Each writer skips work when the provider reports what is already stored. If one of them
 * misbehaves in production it can be turned back into its previous always-write behaviour on its
 * own, without reverting the others and without a code change:
 *
 *   AF_CHANGE_AWARE_WRITES_OFF=weekly-scores                 one writer
 *   AF_CHANGE_AWARE_WRITES_OFF=team-performances,rosters     several
 *   AF_CHANGE_AWARE_WRITES_OFF=all                           every one
 *
 * Unset (the default) means every change-aware writer is ON. The value is read on every call, so
 * it takes effect as soon as the process sees it.
 *
 * ⚠ SET IT ON THE SERVICE THAT RUNS THE SYNC. The league sync and the live tick run on
 * `allfantasy-v2-worker`; imports started by a person run on `allfantasy-v2-main`. Setting a
 * Railway variable redeploys that service (CLAUDE.md, "Writing a Railway variable is a deploy").
 *
 * ⚠ AN UNRECOGNISED NAME IS IGNORED, NOT AN ERROR, so a typo leaves the writer ON. Read the value
 * back after setting it, and confirm the effect in `pg_stat_statements` (the old per-row
 * statements reappear when a writer is switched off).
 */
export const CHANGE_AWARE_WRITERS = ['weekly-scores', 'team-performances', 'rosters', 'matchups'] as const
export type ChangeAwareWriter = (typeof CHANGE_AWARE_WRITERS)[number]

export function changeAwareWritesEnabled(
  writer: ChangeAwareWriter,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = String(env.AF_CHANGE_AWARE_WRITES_OFF ?? '').trim().toLowerCase()
  if (!raw) return true
  const off = new Set(raw.split(/[\s,]+/).filter(Boolean))
  return !(off.has('all') || off.has(writer))
}

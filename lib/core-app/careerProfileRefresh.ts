/**
 * Schedule a career profile rebuild — the hook every import path reaches.
 *
 * ⚠ CALLED FROM `calculateAndSaveRank`, NOT FROM EACH IMPORTER. Seven import
 * paths already finish by recalculating the rank (Sleeper legacy, the batch
 * route, the commit service, the ranking import, the link flow…), so that one
 * function is the choke point. Wiring each importer separately is how a hook gets
 * forgotten on the eighth.
 *
 * ⚠ COALESCED PER USER. `processImportJob` recalculates once per imported
 * SEASON, so a six-season import calls this six times in a row. Only one rebuild
 * runs at a time for a user; calls that arrive meanwhile collapse into one more
 * pass after it, which is guaranteed to see the last season's rows.
 *
 * ⚠ NEVER THROWS AND NEVER AWAITS. It rides on the tail of an import or a rank
 * write, and a cache must not be able to fail either. The read path rebuilds on
 * its own when the stored profile is missing or stale, so a refresh that never
 * runs costs one slower first visit — not a wrong page.
 *
 * ⚠ NO `server-only` AND A DYNAMIC IMPORT, because `calculateRank.ts` is also
 * run from `scripts/` under plain tsx, where the profile module cannot load.
 * There the import fails, is caught, and the script carries on.
 */

const pending = new Map<string, { again: boolean }>()

export function careerProfileRefreshDisabled(): boolean {
  return process.env.CORE_CAREER_PROFILE_DISABLED === '1' || process.env.NODE_ENV === 'test'
}

export function scheduleCareerProfileRefresh(userId: string | null | undefined): void {
  if (!userId || careerProfileRefreshDisabled()) return
  const held = pending.get(userId)
  if (held) {
    held.again = true
    return
  }
  const state = { again: false }
  pending.set(userId, state)
  void (async () => {
    try {
      const { refreshCareerProfile } = await import('@/lib/core-app/careerProfile')
      do {
        state.again = false
        await refreshCareerProfile(userId)
      } while (state.again)
    } catch (err) {
      console.warn('[career-profile] refresh skipped:', err instanceof Error ? err.message : err)
    } finally {
      pending.delete(userId)
    }
  })()
}

/** Test seam. */
export function __pendingCareerRefreshes(): number {
  return pending.size
}

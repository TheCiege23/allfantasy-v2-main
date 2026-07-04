import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isSiteAdmin } from '@/lib/auth/admin'

/**
 * Second, independent gate a namespace's live.ts checks before ever
 * attempting a real Decision OS call — beyond isLiveReady() and the
 * commissioner_os_data_mode cookie (see PRODUCTION_VISUAL_UPDATE_AUDIT.md
 * and GATE_OPENING_PLAN.md's Option C). Reuses the app's existing
 * site-admin allowlist (lib/auth/admin.ts's isSiteAdmin(), already backed
 * by ALL_ACCESS_USERNAMES/ADMIN_EMAILS and the static theciege26 entry)
 * rather than inventing a new one. No session or an unlisted account both
 * resolve to false — a real, expected state, not an error — matching the
 * same convention resolveDecisionOSAuthHeaders() already uses.
 */
export async function canAccessLiveDecisionOSData(): Promise<boolean> {
  try {
    const session = await getServerSession(authOptions)
    return isSiteAdmin(session?.user ?? null)
  } catch {
    return false
  }
}

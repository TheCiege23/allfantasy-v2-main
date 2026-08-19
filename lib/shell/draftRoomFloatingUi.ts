/**
 * Draft room mounts bottom-fixed controls (War Room, chat, queue rail).
 * Global shells (e.g. Chimmy FAB) should not stack on the same corner.
 *
 * /dashboard/universal mounts its own real tabbed floating chat (DMs/Huddle/
 * Chimmy, league-aware) in the same bottom-right corner -- the global FAB
 * (which just navigates to /ai-chat) would stack on top of it.
 */

export function shouldHideChimmyFloatingFab(pathname: string | null | undefined): boolean {
  const p = pathname ?? ''
  if (p.includes('/draft/')) return true
  if (/\/league\/[^/]+\/draft(\/|$)/.test(p)) return true
  if (p.startsWith('/dashboard/universal')) return true
  return false
}

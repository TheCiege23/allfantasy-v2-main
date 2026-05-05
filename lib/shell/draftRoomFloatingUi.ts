/**
 * Draft room mounts bottom-fixed controls (War Room, chat, queue rail).
 * Global shells (e.g. Chimmy FAB) should not stack on the same corner.
 */

export function shouldHideChimmyFloatingFab(pathname: string | null | undefined): boolean {
  const p = pathname ?? ''
  if (p.includes('/draft/')) return true
  if (/\/league\/[^/]+\/draft(\/|$)/.test(p)) return true
  return false
}

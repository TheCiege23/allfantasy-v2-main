"use client"

import { ResponsiveNavSystem } from "./ResponsiveNavSystem"

export interface GlobalShellClientProps {
  isAuthenticated: boolean
  isAdmin: boolean
  userLabel: string | null
  children: React.ReactNode
  /** Dashboard cleanup — hide the global top nav on this route only. */
  hideHeader?: boolean
}

/**
 * Client wrapper for global shell: responsive nav (desktop bar + mobile drawer) + content.
 */
export function GlobalShellClient({
  isAuthenticated,
  isAdmin,
  userLabel,
  children,
  hideHeader = false,
}: GlobalShellClientProps) {
  return (
    <ResponsiveNavSystem
      isAuthenticated={isAuthenticated}
      isAdmin={isAdmin}
      userLabel={userLabel}
      hideHeader={hideHeader}
    >
      {children}
    </ResponsiveNavSystem>
  )
}

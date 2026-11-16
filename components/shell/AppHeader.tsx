"use client"

import DesktopNavBar from "@/components/navigation/DesktopNavBar"

interface AppHeaderProps {
  isAuthenticated: boolean
  isAdmin?: boolean
  userLabel?: string | null
  onOpenMobileMenu?: () => void
  onOpenSearch?: () => void
  mobileMenuOpen?: boolean
}

/**
 * Global app header wrapper (desktop + mobile controls).
 */
export function AppHeader(props: AppHeaderProps) {
  return <DesktopNavBar {...props} />
}

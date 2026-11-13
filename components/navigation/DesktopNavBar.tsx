"use client"

/**
 * Desktop navigation bar. Renders the persistent top header (logo, product switcher, tabs, user menu, etc.).
 * Implemented by GlobalTopNav; this module provides the spec name and a single import for shell composition.
 */
import GlobalTopNav from "@/components/shared/GlobalTopNav"

interface DesktopNavBarProps {
  isAuthenticated: boolean
  isAdmin?: boolean
  userLabel?: string | null
  onOpenMobileMenu?: () => void
  onOpenSearch?: () => void
  mobileMenuOpen?: boolean
}

export default function DesktopNavBar(props: DesktopNavBarProps) {
  return <GlobalTopNav {...props} />
}

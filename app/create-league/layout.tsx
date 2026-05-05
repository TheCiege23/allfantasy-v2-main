import type { ReactNode } from "react"
import ProductShellLayout from "@/components/navigation/ProductShellLayout"

/**
 * Create-league cleanup: hide the global top header and the global right rail
 * (Notifications / AI Quick Ask / Wallet Summary) so the form fills the
 * viewport. The page already has its own header bar (Back / New league /
 * Import / Home) inside CreateLeaguePageClient, so we don't lose the controls.
 */
export default function CreateLeagueLayout({ children }: { children: ReactNode }) {
  return (
    <ProductShellLayout hideHeader hideSidebar>
      {children}
    </ProductShellLayout>
  )
}

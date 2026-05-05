import type { ReactNode } from "react"
import ProductShellLayout from "@/components/navigation/ProductShellLayout"

/**
 * Dashboard cleanup: dashboard hides the global top header and the global
 * right rail (AppSidebar). Top-header functionality is wired into the
 * dashboard's center button row + the in-shell user/gear menu instead.
 * Other routes still use the default ProductShellLayout chrome.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ProductShellLayout hideHeader hideSidebar>
      {children}
    </ProductShellLayout>
  )
}

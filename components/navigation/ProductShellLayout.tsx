import type { ReactNode } from 'react'
import GlobalAppShell from '@/components/shared/GlobalAppShell'

type ProductShellLayoutProps = {
  children: ReactNode
  /** Dashboard cleanup — hide the global top nav on this route only. */
  hideHeader?: boolean
  /** Dashboard cleanup — hide the global right rail on this route only. */
  hideSidebar?: boolean
}

export default async function ProductShellLayout({
  children,
  hideHeader = false,
  hideSidebar = false,
}: ProductShellLayoutProps) {
  return (
    <GlobalAppShell hideHeader={hideHeader} hideSidebar={hideSidebar}>
      {children}
    </GlobalAppShell>
  )
}

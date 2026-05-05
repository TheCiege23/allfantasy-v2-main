import type { ReactNode } from "react"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { resolveAdminEmail } from "@/lib/auth/admin"
import { GlobalShellClient } from "@/components/shell/GlobalShellClient"
import { AppSidebar } from "@/components/shell/AppSidebar"
import { ShellLayoutContainer } from "@/components/shell/ShellLayoutContainer"

type GlobalAppShellProps = {
  children: ReactNode
  /** Dashboard cleanup — hide the global top nav on this route only. */
  hideHeader?: boolean
  /** Dashboard cleanup — hide the global right rail (AppSidebar) on this route only. */
  hideSidebar?: boolean
}

export default async function GlobalAppShell({
  children,
  hideHeader = false,
  hideSidebar = false,
}: GlobalAppShellProps) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { email?: string | null; name?: string | null }
  } | null

  const isAuthenticated = Boolean(session?.user)
  const isAdmin = resolveAdminEmail(session?.user?.email)
  const userLabel = session?.user?.name || session?.user?.email || "Guest"

  return (
    <div className="min-h-screen mode-surface transition-colors">
      <GlobalShellClient
        isAuthenticated={isAuthenticated}
        isAdmin={isAdmin}
        userLabel={userLabel}
        hideHeader={hideHeader}
      >
        {hideSidebar ? (
          /* Full-bleed: dashboard handles its own 3-column layout (AppShell) and
             needs the entire viewport. The 1400px cap and lg:px-4 gutters from
             the default container would otherwise create side margins on wide
             screens. */
          <ShellLayoutContainer
            maxWidth="max-w-none"
            paddingClassName="px-0"
            className=""
          >
            <div className="min-w-0">{children}</div>
          </ShellLayoutContainer>
        ) : (
          <ShellLayoutContainer
            maxWidth="max-w-[1400px]"
            paddingClassName="px-0 lg:px-4"
            className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6"
          >
            <div className="min-w-0">{children}</div>
            <div className="hidden py-6 lg:block">
              <AppSidebar />
            </div>
          </ShellLayoutContainer>
        )}
      </GlobalShellClient>
    </div>
  )
}

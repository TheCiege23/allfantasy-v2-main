/**
 * DashboardQuickActionResolver — quick action buttons for dashboard.
 */

interface QuickActionConfig {
  id: string
  label: string
  href: string
  description: string
}

const DASHBOARD_QUICK_ACTIONS: QuickActionConfig[] = [
  {
    id: "create_bracket_pool",
    label: "Create Bracket Pool",
    href: "/brackets/leagues/new",
    description: "Start your own challenge.",
  },
  {
    id: "join_bracket_pool",
    label: "Join Bracket Pool",
    href: "/brackets/join",
    description: "Join a pool with an invite code.",
  },
  {
    id: "open_webapp",
    label: "Open WebApp",
    href: "/dashboard",
    description: "Leagues, roster, waivers, trades.",
  },
  {
    id: "open_legacy",
    label: "Open Legacy AI",
    href: "/af-legacy",
    description: "Team scan, trade center, draft war room.",
  },
  {
    id: "open_tools_hub",
    label: "Open Tools Hub",
    href: "/tools-hub",
    description: "Cross-product tools and AI workflows.",
  },
  {
    id: "open_notifications",
    label: "Open Notifications",
    href: "/app/notifications",
    description: "Review in-app alerts and updates.",
  },
  {
    id: "open_settings",
    label: "Open Settings",
    href: "/settings",
    description: "Manage profile, preferences, and security.",
  },
]

interface DashboardQuickActionInput {
  isAdmin?: boolean
}

export function getDashboardQuickActions(input?: DashboardQuickActionInput): QuickActionConfig[] {
  const actions = [...DASHBOARD_QUICK_ACTIONS]
  if (input?.isAdmin) {
    actions.push({
      id: "open_admin",
      label: "Open Admin",
      href: "/admin",
      description: "Open the admin dashboard.",
    })
  }
  return actions
}

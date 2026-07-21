/**
 * Operator Command Center navigation — the single source of truth for the
 * sidebar, the section router (app/admin/operator/[section]), section headers,
 * and global search. Keep this list and the section router in lockstep.
 *
 * `status` is an HONESTY signal, surfaced in the sidebar and section header:
 *   - "live"    — backed by a real data service and useful right now
 *   - "partial" — some real data is shown, but parts of the spec are not wired
 *                 yet and are clearly labelled as such in the section
 *   - "planned" — no real data source yet; the section renders an honest
 *                 placeholder, never a fabricated "healthy" state
 *
 * This is intentionally plain data (no JSX / no server imports) so it can be
 * imported from both server components and the client sidebar.
 */

export type OperatorSectionStatus = "live" | "partial" | "planned"

export type OperatorSectionGroup =
  | "command"
  | "operations"
  | "business"
  | "governance"

export type OperatorSection = {
  /** URL slug. The overview uses "" (the /admin/operator index). */
  slug: string
  label: string
  group: OperatorSectionGroup
  /** Icon key resolved to a lucide component in the client sidebar. */
  icon: string
  status: OperatorSectionStatus
  /** One-line description shown in the section header and placeholders. */
  description: string
  /** Static badge (e.g. "NEW"). Numeric counts are computed live, not here. */
  badge?: string
}

export const OPERATOR_BASE_PATH = "/admin/operator"

export const OPERATOR_GROUP_LABELS: Record<OperatorSectionGroup, string | null> = {
  command: null, // top group is unlabelled, like the mockup
  operations: "Operations",
  business: "Business",
  governance: "Governance",
}

export const OPERATOR_SECTIONS: OperatorSection[] = [
  // ── Command ────────────────────────────────────────────────────────────────
  {
    slug: "",
    label: "Overview",
    group: "command",
    icon: "gauge",
    status: "live",
    description: "Platform health, urgent operator actions, and live operations at a glance.",
  },
  {
    slug: "platform-os",
    label: "Platform OS",
    group: "command",
    icon: "boxes",
    status: "live",
    description:
      "Explicit, no-auto-discovery Platform OS snapshot for the exact league IDs you query.",
    badge: "NEW",
  },
  {
    slug: "attention",
    label: "Attention Queue",
    group: "command",
    icon: "alert-triangle",
    status: "live",
    description: "Platform-wide operator-attention signals derived from real metrics, ranked by severity.",
  },

  // ── Operations ───────────────────────────────────────────────────────────────
  {
    slug: "users",
    label: "Users",
    group: "operations",
    icon: "users",
    status: "live",
    description: "Search accounts, review identity, subscription, token, and risk signals.",
  },
  {
    slug: "leagues",
    label: "Leagues",
    group: "operations",
    icon: "trophy",
    status: "partial",
    description: "Global league directory across native and imported leagues.",
  },
  {
    slug: "imports",
    label: "Imports",
    group: "operations",
    icon: "download-cloud",
    status: "partial",
    description: "Import volume, success/failure, and sync-job health per provider and sport.",
  },
  {
    slug: "data-providers",
    label: "Data Providers",
    group: "operations",
    icon: "radio",
    status: "live",
    description: "Health, configuration, and coverage for every configured data provider.",
  },
  {
    slug: "sports-data",
    label: "Sports Data",
    group: "operations",
    icon: "database",
    status: "live",
    description: "Per-sport data freshness, identity health, and provider reconciliation.",
  },
  {
    slug: "decision-os",
    label: "Decision OS",
    group: "operations",
    icon: "brain-circuit",
    status: "partial",
    description: "Decision OS signal governance, coverage, and readiness across scopes.",
  },
  {
    slug: "chimmy",
    label: "Chimmy Intelligence",
    group: "operations",
    icon: "bot",
    status: "live",
    description: "Chimmy usage, cost, provider health, and audit logs.",
  },
  {
    slug: "automation",
    label: "Automation",
    group: "operations",
    icon: "workflow",
    status: "partial",
    description: "Cron and automation job health, schedules, and controls.",
  },
  {
    slug: "draft-operations",
    label: "Draft Operations",
    group: "operations",
    icon: "list-ordered",
    status: "planned",
    description: "Active, scheduled, and stuck drafts with safe operator interventions.",
  },
  {
    slug: "communications",
    label: "Communications",
    group: "operations",
    icon: "megaphone",
    status: "live",
    description: "Email, notification, and broadcast delivery — with test vs production separation.",
  },

  // ── Business ─────────────────────────────────────────────────────────────────
  {
    slug: "subscriptions",
    label: "Subscriptions",
    group: "business",
    icon: "credit-card",
    status: "live",
    description: "Plans, trials, failed payments, and entitlement state.",
  },
  {
    slug: "tokens",
    label: "Tokens",
    group: "business",
    icon: "coins",
    status: "live",
    description: "Token ledger, grants, spend, and cost-governance signals.",
  },
  {
    slug: "payments",
    label: "Payments",
    group: "business",
    icon: "receipt",
    status: "partial",
    description: "Stripe-connected revenue, refunds, failed payments, and reconciliation.",
  },
  {
    slug: "legacy-rankings",
    label: "Legacy & Rankings",
    group: "business",
    icon: "award",
    status: "planned",
    description: "Global rankings, historical seasons, and legacy profiles.",
  },

  // ── Governance ───────────────────────────────────────────────────────────────
  {
    slug: "moderation",
    label: "Moderation",
    group: "governance",
    icon: "gavel",
    status: "partial",
    description: "Community safety reports and moderation actions.",
  },
  {
    slug: "security",
    label: "Security",
    group: "governance",
    icon: "shield-alert",
    status: "partial",
    description: "Admin access, suspicious activity, and shared-secret exposure signals.",
  },
  {
    slug: "audit-logs",
    label: "Audit Logs",
    group: "governance",
    icon: "scroll-text",
    status: "partial",
    description: "Append-only trail of admin, automation, and mutation actions.",
  },
  {
    slug: "feature-flags",
    label: "Feature Flags",
    group: "governance",
    icon: "flag",
    status: "partial",
    description: "Environment, global, and emergency kill-switch flags.",
  },
  {
    slug: "incidents",
    label: "Incidents",
    group: "governance",
    icon: "siren",
    status: "planned",
    description: "Lightweight incident lifecycle and status tracking.",
  },
  {
    slug: "support-tools",
    label: "Support Tools",
    group: "governance",
    icon: "life-buoy",
    status: "partial",
    description: "Diagnosis-first support workspace with safe, narrow actions.",
  },
  {
    slug: "system-settings",
    label: "System Settings",
    group: "governance",
    icon: "settings",
    status: "partial",
    description: "Environment-scoped operational settings and configuration.",
  },
]

const SECTION_BY_SLUG = new Map(OPERATOR_SECTIONS.map((s) => [s.slug, s]))

export function getOperatorSection(slug: string | undefined | null): OperatorSection | null {
  return SECTION_BY_SLUG.get((slug ?? "").trim()) ?? null
}

export function operatorSectionHref(section: OperatorSection): string {
  return section.slug ? `${OPERATOR_BASE_PATH}/${section.slug}` : OPERATOR_BASE_PATH
}

export const OPERATOR_STATUS_LABEL: Record<OperatorSectionStatus, string> = {
  live: "Live",
  partial: "Partial",
  planned: "Planned",
}

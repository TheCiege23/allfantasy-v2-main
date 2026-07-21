import { notFound } from "next/navigation"
import type { ReactNode } from "react"
import { getOperatorSection } from "@/lib/admin-dashboard/operatorNav"
import { SectionHeader, SectionPlaceholder } from "@/components/admin/operator/primitives"
import {
  AttentionSection,
  PlatformOsSection,
  DecisionOsSection,
  ChimmySection,
} from "@/components/admin/operator/sections/IntelSections"
import {
  UsersSection,
  LeaguesSection,
  DataProvidersSection,
  SportsDataSection,
  ImportsSection,
  AutomationSection,
} from "@/components/admin/operator/sections/OpsSections"
import {
  SubscriptionsSection,
  TokensSection,
  PaymentsSection,
  CommunicationsSection,
} from "@/components/admin/operator/sections/BizSections"
import {
  ModerationSection,
  SecuritySection,
  AuditLogsSection,
  FeatureFlagsSection,
  SupportToolsSection,
  SystemSettingsSection,
} from "@/components/admin/operator/sections/GovSections"

export const dynamic = "force-dynamic"

function renderBody(slug: string, q: string): ReactNode {
  switch (slug) {
    case "attention":
      return <AttentionSection />
    case "platform-os":
      return <PlatformOsSection />
    case "decision-os":
      return <DecisionOsSection />
    case "chimmy":
      return <ChimmySection />
    case "users":
      return <UsersSection q={q} />
    case "leagues":
      return <LeaguesSection />
    case "data-providers":
      return <DataProvidersSection />
    case "sports-data":
      return <SportsDataSection />
    case "imports":
      return <ImportsSection />
    case "automation":
      return <AutomationSection />
    case "subscriptions":
      return <SubscriptionsSection />
    case "tokens":
      return <TokensSection />
    case "payments":
      return <PaymentsSection />
    case "communications":
      return <CommunicationsSection />
    case "moderation":
      return <ModerationSection />
    case "security":
      return <SecuritySection />
    case "audit-logs":
      return <AuditLogsSection />
    case "feature-flags":
      return <FeatureFlagsSection />
    case "support-tools":
      return <SupportToolsSection />
    case "system-settings":
      return <SystemSettingsSection />
    case "draft-operations":
      return (
        <SectionPlaceholder
          title="Draft Operations Center"
          description="No dedicated admin draft-operations data source is wired into this view yet. There is deliberately no casual 'force pick' button — any exceptional mutation will be reason-required, impact-previewed, permission-checked, and fully audited."
          willInclude={[
            "Active / scheduled / paused / completed drafts",
            "Expired picks, autopick events, queue + timer status",
            "Emergency pause/resume and stuck-state repair (audited)",
            "Commissioner intervention log",
          ]}
        />
      )
    case "legacy-rankings":
      return (
        <SectionPlaceholder
          title="Legacy & Rankings Operations"
          description="Ranking recalculation, historical seasons, achievements, and legacy profiles are not surfaced in this operator view yet."
          willInclude={[
            "Global / league / power rankings with version + coverage",
            "Historical seasons, achievements, badges, Hall of Fame",
            "Recalculation with dry-run, scope, before/after, rollback",
            "Data-quality review + user appeals",
          ]}
        />
      )
    case "incidents":
      return (
        <SectionPlaceholder
          title="Incident Management"
          description="No incident tracker is configured. Rather than show a green '0 incidents' — which would be indistinguishable from 'not monitored' — this stays explicitly unconfigured."
          willInclude={[
            "Declare incident, set severity/service/owner",
            "Timeline + status (root cause not forced before it's known)",
            "Link alerts, enable maintenance banner, disable a feature",
            "Resolve + postmortem tracking",
          ]}
          note="When wired, Open Incidents on the overview will switch from 'Not configured' to a real count."
        />
      )
    default:
      return null
  }
}

export default function OperatorSectionPage({
  params,
  searchParams,
}: {
  params: { section: string }
  searchParams?: { q?: string | string[] }
}) {
  const section = getOperatorSection(params.section)
  // The overview lives at the index route, not here.
  if (!section || section.slug === "") notFound()

  const q = Array.isArray(searchParams?.q) ? searchParams?.q[0] ?? "" : searchParams?.q ?? ""

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title={section.label} description={section.description} status={section.status} />
      {renderBody(section.slug, q)}
    </div>
  )
}

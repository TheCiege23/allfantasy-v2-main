/**
 * Operator sections: Attention Queue, Platform OS, Decision OS, Chimmy.
 * Server components that fold in the existing real panels + derived signals.
 */
import { getOperatorOverviewData } from "@/lib/admin-dashboard/operatorData"
import { buildOperatorAttentionQueue, summarizeAttention } from "@/lib/admin-dashboard/operatorAttention"
import { Panel, Stat, PartialDataWarning, SectionPlaceholder } from "@/components/admin/operator/primitives"
import { AttentionQueueList } from "@/components/admin/operator/AttentionQueueList"
import { PlatformOsOperatorPanel } from "@/components/admin/PlatformOsOperatorPanel"
import { ChimmyKPIReadout } from "@/components/admin/ChimmyKPIReadout"
import { AiProviderHealthPanel } from "@/components/admin/AiProviderHealthPanel"
import { AiAuditLogsPanel } from "@/components/admin/AiAuditLogsPanel"

export async function AttentionSection() {
  const { metrics } = await getOperatorOverviewData()
  const items = buildOperatorAttentionQueue(metrics)
  const { bySeverity } = summarizeAttention(items)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Total" value={items.length} />
        <Stat label="Critical" value={bySeverity.critical} tone={bySeverity.critical > 0 ? "critical" : "healthy"} />
        <Stat label="High" value={bySeverity.high} tone={bySeverity.high > 0 ? "warn" : "healthy"} />
        <Stat label="Medium" value={bySeverity.medium} tone={bySeverity.medium > 0 ? "warn" : "healthy"} />
        <Stat label="Low / info" value={bySeverity.low + bySeverity.informational} />
      </div>
      <Panel title="All attention signals">
        <AttentionQueueList items={items} />
      </Panel>
    </div>
  )
}

export function PlatformOsSection() {
  return (
    <div className="flex flex-col gap-4">
      <PartialDataWarning>
        Platform OS never auto-discovers leagues. It returns a snapshot for exactly the league IDs you enter — nothing
        is fetched until you submit.
      </PartialDataWarning>
      <Panel eyebrow="Decision OS" title="Platform OS snapshot (explicit league IDs)">
        <PlatformOsOperatorPanel />
      </Panel>
    </div>
  )
}

export function DecisionOsSection() {
  return (
    <div className="flex flex-col gap-4">
      <Panel eyebrow="Decision OS" title="Explicit league aggregation">
        <PlatformOsOperatorPanel />
      </Panel>
      <SectionPlaceholder
        title="Decision OS governance controls"
        description="Signal-level governance (enable/disable a signal type, threshold changes, dry-run evaluation, version compare, replay, quarantine, rollback) is not wired into this operator view yet. The Platform OS snapshot above is real; the governance surface below is planned."
        willInclude={[
          "Signal generation health + suppressed/unavailable counts",
          "Confidence distribution and data-source coverage",
          "Dry-run evaluation and version comparison",
          "Quarantine a faulty signal / roll back a rules version (audited)",
        ]}
        note="No production-wide threshold change will be possible without explicit confirmation and audit logging."
      />
    </div>
  )
}

export function ChimmySection() {
  return (
    <div className="flex flex-col gap-4">
      <Panel eyebrow="Chimmy" title="Usage & KPIs">
        <ChimmyKPIReadout />
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Chimmy" title="AI provider health">
          <AiProviderHealthPanel />
        </Panel>
        <Panel eyebrow="Chimmy" title="AI audit logs">
          <AiAuditLogsPanel />
        </Panel>
      </div>
    </div>
  )
}

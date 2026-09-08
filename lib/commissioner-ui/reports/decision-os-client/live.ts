import { isLiveReady } from '../../liveReadiness'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import { REPORT_TEMPLATES } from '@/lib/commissioner-reports/reportCatalog'
import { readLastRunByTemplate, readReportHistory } from '@/lib/commissioner-reports/reportStore'
import type {
  GeneratedReport,
  ReportFormat,
  ReportShareStatus,
  ReportStatus,
  ReportTemplate,
  ReportsClient,
  ReportsSummary,
} from './types'

/**
 * Commissioner Reports, wired to a real catalog and a real artifact store.
 *
 * ── WHAT THIS MODULE USED TO SAY, AND WHY IT WAS RIGHT ───────────────────────────────────────
 *
 * Phase 3.x declined to wire Reports and was precise: it is "a persisted-artifact system, the same
 * structural class of gap as Automation Center's execution log, not a porting gap." It then
 * rejected generating a report live, because that "would still require fabricating `status`,
 * `generatedAt` (of a generation event that never happened), `format`, `sizeLabel`, and
 * `shareLink`".
 *
 * The distinction it drew — between DESCRIBING a generation and PERFORMING one — is the right one,
 * and it is what has changed. `lib/commissioner-reports/` performs generations and keeps the
 * output, so every field it listed is now a measurement rather than an invention. `shareLink` is
 * the single exception, and it is handled by not existing: sharing has no implementation, so
 * `shareStatus` is always 'private' and no link is ever emitted.
 *
 * ⚠ IT ALSO RULED THAT AN EMPTY ARRAY IS DISHONEST HERE, and that ruling still stands. An empty
 * `getTemplates()`/`getHistory()` would report "we have no way to check" as "you have configured
 * zero templates" / "generated zero reports". Templates therefore always have content — they are a
 * code catalog — and an empty history is only ever returned alongside a real catalog, where it
 * genuinely means "nothing generated yet" rather than "nothing was looked at".
 */

const CATEGORIES: ReadonlySet<string> = new Set(['season_recap', 'engagement', 'transactions', 'commissioner_digest'])
const STATUSES: ReadonlySet<string> = new Set(['queued', 'generating', 'ready', 'failed'])

/**
 * `sizeBytes` → the label a person reads.
 *
 * ⚠ Rendered from the REAL byte count, which is why this exists rather than a stored label. The
 * view previously hard-coded "128 KB" on a simulated generation; a label computed from a column is
 * the thing that cannot drift away from the artifact it describes.
 */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * A template's next run, derived from the last artifact rather than stored.
 *
 * A stored `nextRunAt` is a second source of truth that drifts the moment a run is missed or
 * back-filled, and drifts silently because nothing reconciles it against the history.
 */
function nextRunAt(frequency: string, last: Date | undefined, now: Date): string | undefined {
  if (frequency === 'manual') return undefined
  const periodDays = frequency === 'weekly' ? 7 : 30
  const base = last ?? now
  const next = new Date(base.getTime() + periodDays * 86_400_000)
  // A template that is already overdue is due now, not at some point in the past.
  return (next.getTime() < now.getTime() ? now : next).toISOString()
}

function notYetIntegrated(message: string) {
  return {
    category: 'upstream_unavailable' as const,
    message,
    moduleId: 'reports' as const,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

async function templatesFor(leagueId: string, now: Date): Promise<ReportTemplate[]> {
  const lastRuns = await readLastRunByTemplate(leagueId)
  return REPORT_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: CATEGORIES.has(t.category) ? t.category : 'commissioner_digest',
    sourceModuleIds: t.sourceModuleIds,
    schedule: {
      frequency: t.frequency,
      ...(nextRunAt(t.frequency, lastRuns.get(t.id), now) ? { nextRunAt: nextRunAt(t.frequency, lastRuns.get(t.id), now) } : {}),
    },
  }))
}

export const liveReportsClient: ReportsClient = {
  async getTemplates() {
    const timestamp = new Date().toISOString()
    if (!(await isLiveReady('reports'))) {
      return {
        data: null,
        error: notYetIntegrated('The live Decision OS backend is not yet integrated in this environment.'),
        source: 'live',
        timestamp,
      }
    }
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated('No active league could be resolved for this session.'), source: 'live', timestamp }
    }
    return { data: await templatesFor(leagueId, new Date()), error: null, source: 'live', timestamp }
  },

  async getHistory() {
    const timestamp = new Date().toISOString()
    if (!(await isLiveReady('reports'))) {
      return {
        data: null,
        error: notYetIntegrated('The live Decision OS backend is not yet integrated in this environment.'),
        source: 'live',
        timestamp,
      }
    }
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated('No active league could be resolved for this session.'), source: 'live', timestamp }
    }

    const rows = await readReportHistory(leagueId)
    /*
     * Keyed by plain `string`, not by the catalog's own id union. A stored row carries whatever id
     * was current when it was generated, and a template retired from the catalog leaves its
     * artifacts behind — so the lookup has to be able to MISS. Typing the key as the union would
     * make that miss unrepresentable and force a cast at the call site.
     */
    const byId = new Map<string, (typeof REPORT_TEMPLATES)[number]>(REPORT_TEMPLATES.map((t) => [t.id, t]))

    const data: GeneratedReport[] = rows.map((row) => {
      const template = byId.get(row.templateId)
      return {
        id: row.id,
        templateId: row.templateId,
        // A template retired from the catalog leaves its artifacts behind; the history must still
        // name them rather than rendering a blank row.
        templateName: template?.name ?? row.templateId,
        status: (STATUSES.has(row.status) ? row.status : 'failed') as ReportStatus,
        format: (row.format === 'csv' ? 'csv' : 'csv') as ReportFormat,
        generatedAt: row.generatedAt.toISOString(),
        generatedByLabel: row.generatedByLabel,
        summary: row.summary,
        sizeLabel: formatSize(row.sizeBytes),
        shareStatus: (row.shareStatus === 'shared' ? 'shared' : 'private') as ReportShareStatus,
        relatedLinks: (template?.sourceModuleIds ?? []).flatMap((moduleId) =>
          moduleId === 'analytics' || moduleId === 'managers' || moduleId === 'workspace' || moduleId === 'league-health' || moduleId === 'mission-control'
            ? [{ moduleId, label: moduleId === 'mission-control' ? 'Mission Control' : moduleId, href: moduleId === 'mission-control' ? '/commissioner-os' : `/commissioner-os/${moduleId}` }]
            : [],
        ),
        ...(row.failureReason ? { failureReason: row.failureReason } : {}),
      }
    })

    return { data, error: null, source: 'live', timestamp }
  },

  async getSummary() {
    const timestamp = new Date().toISOString()
    if (!(await isLiveReady('reports'))) {
      return {
        data: null,
        error: notYetIntegrated('The live Decision OS backend is not yet integrated in this environment.'),
        source: 'live',
        timestamp,
      }
    }
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated('No active league could be resolved for this session.'), source: 'live', timestamp }
    }

    const rows = await readReportHistory(leagueId)
    const ready = rows.filter((r) => r.status === 'ready')
    const scheduled = REPORT_TEMPLATES.filter((t) => t.frequency !== 'manual').length

    const data: ReportsSummary = {
      scheduledCount: scheduled,
      readyCount: ready.length,
      /*
       * The headline names the newest artifact rather than counting, for the same reason Automation
       * Center's does: "3 reports ready" sends a commissioner looking, while the name and age of
       * the newest one is the finding itself.
       */
      headline:
        ready.length === 0
          ? `${scheduled} scheduled report${scheduled === 1 ? '' : 's'}, none generated yet`
          : `Newest: ${byName(ready[0].templateId)} — ${ready.length} report${ready.length === 1 ? '' : 's'} ready`,
    }
    return { data, error: null, source: 'live', timestamp }
  },
}

function byName(templateId: string): string {
  return REPORT_TEMPLATES.find((t) => t.id === templateId)?.name ?? templateId
}

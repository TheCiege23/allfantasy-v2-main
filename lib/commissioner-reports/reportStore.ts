import { prisma } from '@/lib/prisma'
import { readAnalyticsDataWindow } from '@/lib/commissioner-ui/analytics/dataWindow'
import { readWarehouseAnalytics } from '@/lib/commissioner-ui/analytics/warehouseReads'
import { findTemplate, REPORT_TEMPLATES, type ReportTemplateDefinition } from './reportCatalog'

/**
 * Generating a report, and reading the ones that were generated.
 *
 * ── WHY THIS ANSWERS THE MODULE'S OWN REFUSAL ────────────────────────────────────────────────
 *
 * `lib/commissioner-ui/reports/decision-os-client/live.ts` rejected building a report on the fly,
 * and its reason was exactly right: doing so "would still require fabricating `status`,
 * `generatedAt` (of a generation event that never happened), `format`, `sizeLabel`, and
 * `shareLink`". The distinction it drew is between DESCRIBING a generation and PERFORMING one.
 *
 * This performs one. A run happens, its output is stored, and every field it named is then a
 * measurement: `generatedAt` is when it ran, `status` is how it went, `sizeBytes` is the length of
 * the bytes on disk, `format` is what was produced. `shareLink` is the one field still absent —
 * sharing has no implementation, so nothing writes one and `shareStatus` stays 'private'.
 *
 * 🛑 THE GENERATOR AND THE READ SHIP TOGETHER. Root CLAUDE.md's `ingestCFBDStats` case: a surface
 * pointed at a table nothing fills fails silently and looks correct, which is worse than the honest
 * error this module returned before.
 *
 * ⚠ NOT UNDER lib/commissioner-ui/. That tree may not import prisma — an ESLint rule with a bounded
 * exemption list and a test guarding it. The same rule sent `leagueWarehouseReads` to
 * `lib/league-history/` and the task store to `lib/commissioner-workspace/`.
 *
 * ⚠ No `findUnique` below: its `where` takes only unique fields so it cannot carry a soft-delete
 * filter. `findFirst` throughout.
 */

export interface StoredReportRun {
  id: string
  leagueId: string
  templateId: string
  status: string
  format: string
  summary: string
  sizeBytes: number
  generatedByLabel: string
  shareStatus: string
  failureReason: string | null
  generatedAt: Date
}

export interface GenerateReportResult {
  id: string
  templateId: string
  status: 'ready' | 'failed'
  sizeBytes: number
  rows: number
  failureReason?: string
}

/**
 * Build one report for one league and keep the artifact.
 *
 * ⚠ A FAILED GENERATION IS RECORDED, NOT SWALLOWED. A commissioner who asked for a report and got
 * nothing is entitled to see why — and a `failed` row with a reason is the only thing that
 * distinguishes "the generator broke" from "you never asked for one". Returning early on error
 * would leave the two indistinguishable, which is the same ambiguity the workspace read had to
 * solve with `hasEverBeenScanned`.
 */
export async function generateReport(
  leagueId: string,
  templateId: string,
  generatedByLabel = 'Scheduled',
  now = new Date(),
): Promise<GenerateReportResult> {
  const template = findTemplate(templateId)
  if (!template) {
    throw new Error(`unknown report template: ${templateId}`)
  }

  try {
    /*
     * The window is a separate read from the snapshot, and both are the SAME reads League Analytics
     * runs — so a report can never disagree with the page a commissioner would open to check it.
     */
    const [data, window] = await Promise.all([
      readWarehouseAnalytics(leagueId),
      readAnalyticsDataWindow(leagueId),
    ])

    const content = template.build(data, window)
    const rows = content.split('\n').length
    /*
     * Byte length, not string length. A CSV of team names carries multi-byte characters routinely,
     * and `content.length` would under-report the size of exactly the files most likely to be
     * large. This number is shown to a person as "12.4 KB"; it should be the real one.
     */
    const sizeBytes = Buffer.byteLength(content, 'utf8')

    const created = await prisma.commissionerReportRun.create({
      data: {
        leagueId,
        templateId,
        status: 'ready',
        format: 'csv',
        summary: template.summarise(rows, data),
        content,
        sizeBytes,
        generatedByLabel,
        shareStatus: 'private',
        generatedAt: now,
      },
      select: { id: true },
    })

    return { id: created.id, templateId, status: 'ready', sizeBytes, rows }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const created = await prisma.commissionerReportRun.create({
      data: {
        leagueId,
        templateId,
        status: 'failed',
        format: 'csv',
        summary: `${template.name} could not be generated.`,
        content: null,
        sizeBytes: 0,
        generatedByLabel,
        shareStatus: 'private',
        failureReason: reason.slice(0, 500),
        generatedAt: now,
      },
      select: { id: true },
    })
    return { id: created.id, templateId, status: 'failed', sizeBytes: 0, rows: 0, failureReason: reason }
  }
}

/** One league's report history, newest first. Metadata only — the artifact is fetched on download. */
export async function readReportHistory(leagueId: string, limit = 50): Promise<StoredReportRun[]> {
  return prisma.commissionerReportRun.findMany({
    where: { leagueId },
    orderBy: { generatedAt: 'desc' },
    take: Math.min(200, Math.max(1, limit)),
    select: {
      id: true,
      leagueId: true,
      templateId: true,
      status: true,
      format: true,
      summary: true,
      sizeBytes: true,
      generatedByLabel: true,
      shareStatus: true,
      failureReason: true,
      generatedAt: true,
    },
  })
}

/**
 * The artifact itself, for a download.
 *
 * ⚠ SCOPED BY LEAGUE, NOT BY ID ALONE. An id is a uuid and hard to guess, but "hard to guess" is
 * not an authorisation model. Requiring the caller to name the league means a report can only be
 * fetched by someone already established as being in it.
 */
export async function readReportContent(leagueId: string, reportId: string): Promise<{ content: string; templateId: string } | null> {
  const row = await prisma.commissionerReportRun.findFirst({
    where: { id: reportId, leagueId, status: 'ready' },
    select: { content: true, templateId: true },
  })
  if (!row?.content) return null
  return { content: row.content, templateId: row.templateId }
}

/** When each template last produced a READY artifact for this league — what the schedule display needs. */
export async function readLastRunByTemplate(leagueId: string): Promise<Map<string, Date>> {
  const rows = await prisma.commissionerReportRun.groupBy({
    by: ['templateId'],
    where: { leagueId, status: 'ready' },
    _max: { generatedAt: true },
  })
  const out = new Map<string, Date>()
  for (const r of rows) {
    if (r._max.generatedAt) out.set(r.templateId, r._max.generatedAt)
  }
  return out
}

/**
 * Which templates are due for this league.
 *
 * ⚠ DUE IS COMPUTED FROM THE LAST ARTIFACT, NOT FROM A STORED `nextRunAt`. A stored next-run
 * timestamp is a second source of truth that drifts the moment a run is missed, skipped or
 * back-filled — and it drifts silently, because nothing compares it against the history. Deriving
 * it means the schedule is always consistent with what was actually produced.
 */
export function templatesDue(
  lastRuns: Map<string, Date>,
  now: Date,
): ReportTemplateDefinition[] {
  return REPORT_TEMPLATES.filter((t) => {
    // Manual templates are never due; a person asks for them.
    if (t.frequency === 'manual') return false
    const last = lastRuns.get(t.id)
    if (!last) return true
    const days = (now.getTime() - last.getTime()) / 86_400_000
    return t.frequency === 'weekly' ? days >= 7 : days >= 30
  })
}

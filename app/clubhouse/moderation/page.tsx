import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { REPORT_REASON_LABELS, type ReportReason } from '@/lib/moderation/shared'
import { CLUBHOUSE_NAME } from '@/lib/community/channels'
import { timeAgo } from '@/lib/community/format'
import { getCommunityViewer, listPendingReports } from '@/lib/community/service'
import { ClubhouseFrame, EmptyState, PageHeader } from '@/components/community/CommunityBits'
import { ResolveReportButtons } from '@/components/community/ClubhouseClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Moderation | ${CLUBHOUSE_NAME}`,
  robots: { index: false },
}

export default async function ClubhouseModerationPage() {
  const viewer = await getCommunityViewer()
  // A 404 rather than a "forbidden" page: there is no reason to advertise that this exists.
  if (!viewer.isModerator) notFound()

  const reports = await listPendingReports(viewer)
  const now = Date.now()

  return (
    <ClubhouseFrame narrow crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}>
      <PageHeader icon="🛡️" eyebrow="Staff only" title="Moderation queue" sub="Pending reports, oldest first. Removing content closes every report on it." />

      {reports.length === 0 ? (
        <EmptyState icon="✅" title="Nothing to review" body="No pending reports. The Clubhouse is behaving." />
      ) : (
        <ul className="ch-stack">
          {reports.map((r) => (
            <li key={r.id} className="ch-card ch-card-pad">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-500">
                  {REPORT_REASON_LABELS[r.reason as ReportReason] ?? r.reason}
                </span>
                <span>
                  {r.targetType} by @{r.targetAuthorUsername ?? 'unknown'}
                </span>
                <span>· reported by @{r.reporterUsername}</span>
                <span>· {timeAgo(r.createdAt, now)}</span>
                {r.targetRemoved && <span className="font-semibold">· already removed</span>}
              </div>
              <Link href={r.targetHref} className="block text-sm hover:underline" style={{ color: 'var(--text)' }}>
                {r.targetPreview}
              </Link>
              {r.details && (
                <p className="mt-1 text-xs italic" style={{ color: 'var(--muted)' }}>
                  “{r.details}”
                </p>
              )}
              <div className="mt-3">
                <ResolveReportButtons reportId={r.id} targetRemoved={r.targetRemoved} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ClubhouseFrame>
  )
}

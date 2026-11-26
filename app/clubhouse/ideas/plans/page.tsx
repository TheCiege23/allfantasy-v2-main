import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CLUBHOUSE_NAME, clubhousePostHref } from '@/lib/community/channels'
import { timeAgo } from '@/lib/community/format'
import { EFFORT_COPY, PLAN_STATUS_COPY } from '@/lib/community/ideaPlan'
import { listIdeaPlans } from '@/lib/community/ideaPlanRunner'
import { getCommunityViewer } from '@/lib/community/service'
import { ClubhouseFrame, EmptyState, PageHeader } from '@/components/community/CommunityBits'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Build plans | ${CLUBHOUSE_NAME}`,
  robots: { index: false },
}

/** Staff only: every League Lab idea with the plan Chimmy wrote for it, newest first. */
export default async function IdeaPlansPage() {
  const viewer = await getCommunityViewer()
  if (!viewer.isModerator) notFound()
  const items = await listIdeaPlans()
  const now = Date.now()

  return (
    <ClubhouseFrame narrow crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }, { href: '/clubhouse/league-lab', label: 'League Lab' }]}>
      <PageHeader
        icon="🛠️"
        eyebrow="Staff only"
        title="Build plans"
        sub="Chimmy writes one for every League Lab idea, reading the photos and PDFs too. Open an idea to see the full plan or ask the poster a question."
      />
      {items.length === 0 ? (
        <EmptyState icon="💡" title="No plans yet" body="The next League Lab idea gets one automatically." />
      ) : (
        <ul className="ch-stack" data-testid="plan-list">
          {items.map((it) => (
            <li key={it.postId} className="ch-card ch-card-pad">
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: 'var(--muted)' }}>
                <span className="ch-pill">{it.status === 'ready' && it.effort ? EFFORT_COPY[it.effort] : PLAN_STATUS_COPY[it.status]}</span>
                <span>by {it.author}</span>
                <span>· ▲ {it.upvotes}</span>
                {it.files > 0 && <span>· {it.files} file{it.files === 1 ? '' : 's'}</span>}
                {it.questions > 0 && <span>· {it.questions} question{it.questions === 1 ? '' : 's'} for the poster</span>}
                <span>· {timeAgo(it.createdAt, now)}</span>
              </div>
              <Link href={clubhousePostHref(it.postId)} className="block font-semibold hover:underline" style={{ color: 'var(--text)' }}>
                {it.title}
              </Link>
              {it.summary && (
                <p className="mt-1 text-sm" style={{ color: 'var(--text2)' }}>
                  {it.summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </ClubhouseFrame>
  )
}

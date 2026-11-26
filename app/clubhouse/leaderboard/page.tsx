import type { Metadata } from 'next'
import Link from 'next/link'
import { CLUBHOUSE_NAME } from '@/lib/community/channels'
import { POINTS, parseLeaderboardWindow } from '@/lib/community/leaderboard'
import { getCommunityViewer, getLeaderboard, listShippedIdeas } from '@/lib/community/service'
import { Avatar, AuthorBadges, ClubhouseFrame, EmptyState, PageHeader } from '@/components/community/CommunityBits'
import { ShippedFromLeagueLab } from '@/components/community/ShippedFromLeagueLab'
import { displayNameOf } from '@/lib/community/format'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Leaderboard | ${CLUBHOUSE_NAME}`,
  description: 'The members shaping AllFantasy: posts, replies, upvoted ideas and ideas that shipped.',
}

type Props = { searchParams: Promise<{ window?: string }> }

export default async function LeaderboardPage({ searchParams }: Props) {
  const sp = await searchParams
  const window = parseLeaderboardWindow(sp.window)
  const viewer = await getCommunityViewer()
  const [rows, shipped] = await Promise.all([getLeaderboard(viewer, window), listShippedIdeas(3)])

  return (
    <ClubhouseFrame narrow crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}>
      <PageHeader
        icon="🏆"
        eyebrow="Leaderboard"
        title="Top contributors"
        sub={`Posts ${POINTS.post} pts, replies ${POINTS.reply}, each upvote on your idea ${POINTS.upvoteReceived}, an idea that ships ${POINTS.ideaShipped}. The top three this month wear a Top contributor badge.`}
      />
      <nav className="mb-4 flex gap-2" aria-label="Leaderboard period">
        {(['30d', 'all'] as const).map((w) => (
          <Link
            key={w}
            href={w === '30d' ? '/clubhouse/leaderboard' : '/clubhouse/leaderboard?window=all'}
            aria-current={window === w ? 'page' : undefined}
            className={`ch-btn text-sm ${window === w ? 'ch-btn-primary' : 'ch-btn-ghost'}`}
          >
            {w === '30d' ? 'This month' : 'All time'}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon="🏆"
          title="Nobody on the board yet"
          body="Post, reply, or pitch a League Lab idea people upvote. The first few points put you at the top."
        />
      ) : (
        <ol className="ch-stack" data-testid="leaderboard">
          {rows.map((r) => (
            <li key={r.userId} className="ch-card ch-card-pad flex items-center gap-3">
              <span className="ch-mono w-8 shrink-0 text-center text-lg font-bold" style={{ color: r.rank <= 3 ? 'var(--accent)' : 'var(--muted)' }}>
                {r.rank}
              </span>
              <Avatar author={r.author} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/clubhouse/u/${encodeURIComponent(r.author.username)}`} className="font-semibold hover:underline" style={{ color: 'var(--text)' }}>
                    {displayNameOf(r.author)}
                  </Link>
                  <AuthorBadges badges={r.author.badges} />
                </div>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {[
                    r.posts ? `${r.posts} post${r.posts === 1 ? '' : 's'}` : null,
                    r.replies ? `${r.replies} repl${r.replies === 1 ? 'y' : 'ies'}` : null,
                    r.upvotesReceived ? `${r.upvotesReceived} upvote${r.upvotesReceived === 1 ? '' : 's'} on ideas` : null,
                    r.ideasShipped ? `${r.ideasShipped} shipped` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="ch-mono shrink-0 text-sm font-bold" style={{ color: 'var(--text)' }}>
                {r.score} pts
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs" style={{ color: 'var(--faint)' }}>
        The AllFantasy team is not ranked. Automatic threads never count.
      </p>
      {shipped.length > 0 && (
        <div className="mt-8">
          <ShippedFromLeagueLab ideas={shipped} />
        </div>
      )}
    </ClubhouseFrame>
  )
}

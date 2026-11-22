import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { CLUBHOUSE_NAME, clubhouseMemberHref, clubhousePostHref } from '@/lib/community/channels'
import { displayNameOf, timeAgo } from '@/lib/community/format'
import { getCommunityViewer, getMemberProfile } from '@/lib/community/service'
import { AuthorBadges, Avatar, ClubhouseFrame, EmptyState, PostCard } from '@/components/community/CommunityBits'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ username: string }>; searchParams: Promise<{ tab?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params
  const title = `@${decodeURIComponent(username)} | ${CLUBHOUSE_NAME} | AllFantasy`
  return { title, openGraph: { title, url: clubhouseMemberHref(decodeURIComponent(username)) } }
}

export default async function ClubhouseMemberPage({ params, searchParams }: Props) {
  const username = decodeURIComponent((await params).username)
  const tab = (await searchParams).tab === 'replies' ? 'replies' : 'posts'
  const viewer = await getCommunityViewer()
  const profile = await getMemberProfile(username, viewer)
  if (!profile) notFound()

  const { author, counts } = profile
  const now = Date.now()
  const here = clubhouseMemberHref(author.username)
  const joined = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(profile.joinedAt))
  const stats: { label: string; value: number }[] = [
    { label: counts.posts === 1 ? 'post' : 'posts', value: counts.posts },
    { label: counts.replies === 1 ? 'reply' : 'replies', value: counts.replies },
    { label: counts.ideas === 1 ? 'league idea' : 'league ideas', value: counts.ideas },
    { label: 'upvotes on ideas', value: counts.upvotesReceived },
    { label: 'shipped', value: counts.shippedIdeas },
  ]

  return (
    <ClubhouseFrame narrow crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}>
      <header className="ch-card mb-7 overflow-hidden" style={{ padding: 0 }}>
        <div className="ch-banner" style={{ borderRadius: 0 }} aria-hidden />
        <div className="px-5 pb-5 sm:px-7 sm:pb-6">
          <div className="-mt-10 flex flex-wrap items-end justify-between gap-3">
            <Avatar author={author} size={88} />
            <Link href={`/profile/${encodeURIComponent(author.username)}`} className="ch-btn ch-btn-ghost ch-btn-sm">
              Full AllFantasy profile
            </Link>
          </div>
          <h1 className="ch-article-title mt-3">{displayNameOf(author)}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm" style={{ color: 'var(--muted)' }}>
            <span className="ch-mono">@{author.username}</span>
            <AuthorBadges badges={author.badges} />
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--faint)' }}>
            Member since {joined}
          </p>
          <dl className="ch-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', marginTop: 20 }}>
            {stats.map((s) => (
              // dt before dd, as the markup requires; column-reverse puts the number on top.
              <div key={s.label} className="ch-stat flex flex-col-reverse">
                <dt className="ch-stat-label">{s.label}</dt>
                <dd className="ch-stat-num" style={{ fontSize: 22 }}>
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <nav aria-label="Member activity" className="ch-seg mb-5">
        <Link href={here} aria-current={tab === 'posts' ? 'page' : undefined} className="ch-seg-item">
          Posts · <span className="ch-mono">{counts.posts}</span>
        </Link>
        <Link href={`${here}?tab=replies`} aria-current={tab === 'replies' ? 'page' : undefined} className="ch-seg-item">
          Replies · <span className="ch-mono">{counts.replies}</span>
        </Link>
      </nav>

      {tab === 'posts' ? (
        profile.posts.length === 0 ? (
          <EmptyState icon="📝" title="No posts yet" body={`${displayNameOf(author)} hasn't started a thread yet.`} />
        ) : (
          <div className="ch-stack">
            {profile.posts.map((p) => (
              <PostCard key={p.id} post={p} now={now} showChannel />
            ))}
          </div>
        )
      ) : profile.replies.length === 0 ? (
        <EmptyState icon="💬" title="No replies yet" body={`${displayNameOf(author)} hasn't replied to anything yet.`} />
      ) : (
        <ol className="ch-stack">
          {profile.replies.map((r) => (
            <li key={r.id} className="ch-reply">
              <p className="mb-1 text-xs" style={{ color: 'var(--muted)' }}>
                Replied to{' '}
                <Link href={clubhousePostHref(r.postId, r.id)} className="font-semibold underline" style={{ color: 'var(--text)' }}>
                  {censorProfanity(r.postTitle)}
                </Link>{' '}
                · <time dateTime={r.createdAt}>{timeAgo(r.createdAt, now)}</time>
              </p>
              <p className="whitespace-pre-wrap break-words text-sm" style={{ color: 'var(--text)' }}>
                {censorProfanity(r.body)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </ClubhouseFrame>
  )
}

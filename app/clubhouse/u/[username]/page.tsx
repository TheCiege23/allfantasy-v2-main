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
  const tabStyle = (active: boolean) => ({
    borderColor: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--muted)',
  })

  return (
    <ClubhouseFrame crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}>
      <header className="mode-panel mb-6 rounded-xl border p-4 sm:p-5" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-3">
          <Avatar author={author} size={56} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold" style={{ color: 'var(--text)' }}>
              {displayNameOf(author)}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm" style={{ color: 'var(--muted)' }}>
              <span>@{author.username}</span>
              <AuthorBadges badges={author.badges} />
            </div>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted2)' }}>
              Member since {joined}
            </p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {stats.map((s) => (
            // dt before dd, as the markup requires; column-reverse puts the number on top.
            <div key={s.label} className="flex flex-col-reverse rounded-lg p-2 text-center" style={{ background: 'var(--panel2)' }}>
              <dt className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {s.label}
              </dt>
              <dd className="text-lg font-bold tabular-nums" style={{ color: 'var(--text)' }}>
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs">
          <Link href={`/profile/${encodeURIComponent(author.username)}`} className="underline" style={{ color: 'var(--muted)' }}>
            Full AllFantasy profile
          </Link>
        </p>
      </header>

      <nav aria-label="Member activity" className="mb-4 flex gap-4 border-b text-sm" style={{ borderColor: 'var(--border)' }}>
        <Link href={here} aria-current={tab === 'posts' ? 'page' : undefined} className="-mb-px border-b-2 pb-2 font-semibold" style={tabStyle(tab === 'posts')}>
          Posts
        </Link>
        <Link
          href={`${here}?tab=replies`}
          aria-current={tab === 'replies' ? 'page' : undefined}
          className="-mb-px border-b-2 pb-2 font-semibold"
          style={tabStyle(tab === 'replies')}
        >
          Replies
        </Link>
      </nav>

      {tab === 'posts' ? (
        profile.posts.length === 0 ? (
          <EmptyState title="No posts yet" body={`${displayNameOf(author)} hasn't started a thread yet.`} />
        ) : (
          <div className="space-y-3">
            {profile.posts.map((p) => (
              <PostCard key={p.id} post={p} now={now} showChannel />
            ))}
          </div>
        )
      ) : profile.replies.length === 0 ? (
        <EmptyState title="No replies yet" body={`${displayNameOf(author)} hasn't replied to anything yet.`} />
      ) : (
        <ol className="space-y-3">
          {profile.replies.map((r) => (
            <li key={r.id} className="mode-panel rounded-xl border p-3 sm:p-4" style={{ borderColor: 'var(--border)' }}>
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

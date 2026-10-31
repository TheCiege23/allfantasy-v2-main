import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CLUBHOUSE_NAME, clubhouseChannelHref, getChannel } from '@/lib/community/channels'
import { IDEA_CHANNEL, NEW_IDEA_HREF, parseIdeaFilter, parseIdeaSort } from '@/lib/community/ideas'
import { getCommunityViewer, listIdeas, listPosts } from '@/lib/community/service'
import { ClubhouseFrame, EmptyState, PostCard, PrimaryButtonLink, loginHref } from '@/components/community/CommunityBits'
import { IdeaBoard } from '@/components/community/IdeaBoard'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ channel: string }>
  searchParams: Promise<{ before?: string; sort?: string; status?: string; page?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const channel = getChannel((await params).channel)
  if (!channel) return { title: `${CLUBHOUSE_NAME} | AllFantasy` }
  const title = `${channel.label} | ${CLUBHOUSE_NAME} | AllFantasy`
  return { title, description: channel.blurb, openGraph: { title, description: channel.blurb, url: clubhouseChannelHref(channel.slug) } }
}

export default async function ClubhouseChannelPage({ params, searchParams }: Props) {
  const channel = getChannel((await params).channel)
  if (!channel) notFound()
  const sp = await searchParams
  const before = sp.before
  const isLab = channel.slug === IDEA_CHANNEL
  const ideaSort = parseIdeaSort(sp.sort)
  const ideaFilter = parseIdeaFilter(sp.status)

  const viewer = await getCommunityViewer()
  const [page, board] = await Promise.all([
    // League Lab ideas have their own board; the list below them is the discussion.
    listPosts({ viewer, channel: channel.slug, kind: isLab ? 'post' : null, before: before ?? null }),
    isLab && !before
      ? listIdeas({ viewer, sort: ideaSort, filter: ideaFilter, page: Number(sp.page) || 1 })
      : Promise.resolve(null),
  ])
  const now = Date.now()
  const composeHref = `/clubhouse/new?channel=${channel.slug}`
  const newPostHref = viewer.userId ? composeHref : loginHref(composeHref)
  const pitchHref = viewer.userId ? NEW_IDEA_HREF : loginHref(NEW_IDEA_HREF)

  return (
    <ClubhouseFrame crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
            {channel.emoji} {channel.label}
          </h1>
          <p className="mt-1 max-w-xl text-sm" style={{ color: 'var(--muted)' }}>
            {channel.blurb}
          </p>
        </div>
        {isLab ? (
          <div className="flex flex-wrap gap-2">
            <PrimaryButtonLink href={pitchHref}>💡 Pitch an idea</PrimaryButtonLink>
            <Link
              href={newPostHref}
              className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-semibold hover:opacity-90"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              ＋ Discussion post
            </Link>
          </div>
        ) : (
          <PrimaryButtonLink href={newPostHref}>＋ New post</PrimaryButtonLink>
        )}
      </header>

      {isLab && (
        <div className="mb-6 rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          Pitch a league format in three boxes, upvote the ones you would play, and watch them move from{' '}
          <strong>Under review</strong> to <strong>Building</strong> to <strong>Shipped</strong>. Shipped ideas carry
          their creator&apos;s name. Have the whole rulebook written?{' '}
          <Link href="/submit-league" className="font-semibold underline" style={{ color: 'var(--accent)' }}>
            Send the detailed version
          </Link>
          .
        </div>
      )}

      {board && (
        <div className="mb-8">
          <IdeaBoard board={board} sort={ideaSort} filter={ideaFilter} viewerId={viewer.userId} now={now} />
        </div>
      )}

      {isLab && (
        <h2 className="mb-3 text-lg font-bold" style={{ color: 'var(--text)' }}>
          💬 Discussion
        </h2>
      )}

      {page.pinned.length > 0 && (
        <div className="mb-4 space-y-3">
          {page.pinned.map((p) => (
            <PostCard key={p.id} post={p} now={now} />
          ))}
        </div>
      )}

      {page.posts.length === 0 && page.pinned.length === 0 ? (
        <EmptyState
          title="No posts here yet"
          body="Start the first one. Early posts set the tone for everyone who follows."
          action={<PrimaryButtonLink href={newPostHref}>Start the conversation</PrimaryButtonLink>}
        />
      ) : (
        <div className="space-y-3">
          {page.posts.map((p) => (
            <PostCard key={p.id} post={p} now={now} />
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-between text-sm">
        {before ? (
          <Link href={clubhouseChannelHref(channel.slug)} className="underline" style={{ color: 'var(--muted)' }}>
            ← Newest
          </Link>
        ) : (
          <span />
        )}
        {page.nextCursor && (
          <Link
            href={`${clubhouseChannelHref(channel.slug)}?before=${encodeURIComponent(page.nextCursor)}`}
            className="underline"
            style={{ color: 'var(--muted)' }}
          >
            Older posts →
          </Link>
        )}
      </div>
    </ClubhouseFrame>
  )
}

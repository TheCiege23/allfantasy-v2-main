import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CLUBHOUSE_NAME, clubhouseChannelHref, getChannel } from '@/lib/community/channels'
import { IDEA_CHANNEL, NEW_IDEA_HREF, parseIdeaFilter, parseIdeaSort } from '@/lib/community/ideas'
import { getCommunityViewer, listIdeas, listPosts } from '@/lib/community/service'
import {
  ClubhouseFrame,
  EmptyState,
  GhostButtonLink,
  PageHeader,
  PostCard,
  PrimaryButtonLink,
  loginHref,
} from '@/components/community/CommunityBits'
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
    <ClubhouseFrame
      narrow
      active={clubhouseChannelHref(channel.slug)}
      crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}
      cta={<PrimaryButtonLink href={isLab ? pitchHref : newPostHref} small>{isLab ? '💡 Pitch' : '＋ New post'}</PrimaryButtonLink>}
    >
      <PageHeader
        channel={channel.slug}
        icon={channel.emoji}
        eyebrow={isLab ? 'Pitch · vote · ship' : 'Channel'}
        title={channel.label}
        sub={
          isLab ? (
            <>
              Pitch a league format in three boxes, upvote the ones you would play, and watch them move from{' '}
              <strong>Under review</strong> to <strong>Building</strong> to <strong>Shipped</strong>. Shipped ideas carry
              their creator&apos;s name. Whole rulebook written?{' '}
              <Link href="/submit-league" className="font-bold underline" style={{ color: 'var(--tone)' }}>
                Send the detailed version
              </Link>
              .
            </>
          ) : (
            channel.blurb
          )
        }
        actions={
          isLab ? (
            <>
              <PrimaryButtonLink href={pitchHref}>💡 Pitch an idea</PrimaryButtonLink>
              <GhostButtonLink href={newPostHref}>＋ Discussion post</GhostButtonLink>
            </>
          ) : (
            <PrimaryButtonLink href={newPostHref}>＋ New post</PrimaryButtonLink>
          )
        }
      />

      {board && (
        <div className="mb-8">
          <IdeaBoard board={board} sort={ideaSort} filter={ideaFilter} viewerId={viewer.userId} now={now} />
        </div>
      )}

      {isLab && (
        <div className="ch-section-label">
          <h2 className="ch-h2">💬 Discussion</h2>
        </div>
      )}

      {page.pinned.length > 0 && (
        <div className="ch-stack mb-3">
          {page.pinned.map((p) => (
            <PostCard key={p.id} post={p} now={now} />
          ))}
        </div>
      )}

      {page.posts.length === 0 && page.pinned.length === 0 ? (
        <EmptyState
          icon={channel.emoji}
          title="No posts here yet"
          body="Start the first one. Early posts set the tone for everyone who follows."
          action={<PrimaryButtonLink href={newPostHref}>Start the conversation</PrimaryButtonLink>}
        />
      ) : (
        <div className="ch-stack">
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

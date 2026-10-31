import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { CLUBHOUSE_NAME, clubhouseChannelHref, clubhousePostHref, getChannel } from '@/lib/community/channels'
import { getCommunityViewer, getPost } from '@/lib/community/service'
import {
  AuthorLine,
  Avatar,
  ChannelPill,
  ClubhouseFrame,
  PostBody,
  TagPills,
  loginHref,
} from '@/components/community/CommunityBits'
import { PostActions, ReactionBar, ReplyActions, ReplyComposer } from '@/components/community/ClubhouseClient'
import { IdeaCredit, IdeaFacts, IdeaStatusPill } from '@/components/community/IdeaBits'
import { IdeaStatusControl, UpvoteButton } from '@/components/community/IdeaClient'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ postId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { postId } = await params
  const post = await getPost(postId, { userId: null, isModerator: false }).catch(() => null)
  if (!post) return { title: `${CLUBHOUSE_NAME} | AllFantasy` }
  const title = `${censorProfanity(post.title)} | ${CLUBHOUSE_NAME}`
  const description = censorProfanity(post.excerpt)
  return { title, description, openGraph: { title, description, url: clubhousePostHref(post.id) } }
}

export default async function ClubhousePostPage({ params }: Props) {
  const { postId } = await params
  const viewer = await getCommunityViewer()
  const post = await getPost(postId, viewer)
  if (!post) notFound()

  const channel = getChannel(post.channel)
  const now = Date.now()
  const signedIn = Boolean(viewer.userId)
  const here = clubhousePostHref(post.id)
  const login = loginHref(here)

  return (
    <ClubhouseFrame
      narrow
      active={channel ? clubhouseChannelHref(channel.slug) : undefined}
      crumbs={[
        { href: '/clubhouse', label: CLUBHOUSE_NAME },
        ...(channel ? [{ href: clubhouseChannelHref(channel.slug), label: channel.label }] : []),
      ]}
    >
      {post.removed && (
        <p className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm font-semibold text-red-500">
          This post is removed. Only moderators can see it.
        </p>
      )}

      <article data-channel={post.channel} className="ch-card ch-article">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <ChannelPill slug={post.channel} />
          <TagPills tags={post.tags} />
          {post.isPinned && <span className="ch-pill ch-pill-accent">📌 Pinned</span>}
          {post.isLocked && <span className="ch-pill">🔒 Locked</span>}
        </div>
        <div className="mb-3 flex items-start gap-3">
          {post.idea && !post.removed && (
            <UpvoteButton
              postId={post.id}
              initialUpvotes={post.idea.upvotes}
              initialVoted={post.idea.votedByMe}
              signedIn={signedIn}
              isAuthor={viewer.userId === post.author.id}
              loginHref={login}
            />
          )}
          <div className="min-w-0 flex-1">
            {post.idea && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="ch-eyebrow" style={{ color: 'var(--tone)' }}>
                  💡 League idea
                </span>
                <IdeaStatusPill status={post.idea.status} />
                <IdeaFacts idea={post.idea} />
              </div>
            )}
            <h1 className="ch-article-title">
              {censorProfanity(post.title)}
            </h1>
            {post.idea?.hook && (
              <p className="mt-2 text-[16px] leading-relaxed" style={{ color: 'var(--text2)' }}>
                {censorProfanity(post.idea.hook)}
              </p>
            )}
          </div>
        </div>
        {post.idea && (
          <div className="mb-4">
            <IdeaCredit idea={post.idea} author={post.author} now={now} />
          </div>
        )}
        <div className="ch-byline">
          <Avatar author={post.author} size={42} />
          <AuthorLine author={post.author} at={post.createdAt} edited={Boolean(post.editedAt)} now={now} />
        </div>
        <PostBody text={post.body} />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
          <ReactionBar targetType="post" targetId={post.id} initial={post.reactions} signedIn={signedIn} loginHref={login} />
        </div>
        {post.idea && viewer.isModerator && !post.removed && (
          <div className="mt-4">
            <IdeaStatusControl postId={post.id} status={post.idea.status} />
          </div>
        )}
        <div className="mt-2">
          <PostActions
            postId={post.id}
            canEdit={post.canEdit}
            isModerator={viewer.isModerator}
            isPinned={post.isPinned}
            isLocked={post.isLocked}
            removed={post.removed}
            signedIn={signedIn}
            initialTitle={post.title}
            initialBody={post.body}
            initialTags={post.tags}
          />
        </div>
      </article>

      <section aria-labelledby="replies-heading" className="mt-8">
        <div className="ch-section-label">
          <h2 id="replies-heading" className="ch-h2">
            {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
          </h2>
        </div>

        {post.replies.length === 0 && (
          <p className="mb-4 text-sm" style={{ color: 'var(--muted)' }}>
            No replies yet. Be the first to weigh in.
          </p>
        )}

        <ol className="ch-thread mb-6">
          {post.replies.map((r) => (
            <li
              key={r.id}
              id={`reply-${r.id}`}
              className="ch-reply scroll-mt-24"
            >
              {r.removed ? (
                <p className="text-sm italic" style={{ color: 'var(--muted2)' }}>
                  This reply was removed.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2.5">
                    <Avatar author={r.author} size={32} />
                    <AuthorLine author={r.author} at={r.createdAt} edited={Boolean(r.editedAt)} now={now} />
                  </div>
                  <PostBody text={r.body} />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ReactionBar targetType="reply" targetId={r.id} initial={r.reactions} signedIn={signedIn} loginHref={login} />
                    <ReplyActions
                      replyId={r.id}
                      canEdit={r.canEdit}
                      isModerator={viewer.isModerator}
                      signedIn={signedIn}
                      initialBody={r.body}
                    />
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>

        {!post.removed && (
          <ReplyComposer
            postId={post.id}
            signedIn={signedIn}
            loginHref={login}
            locked={post.isLocked}
            canReplyWhenLocked={viewer.isModerator}
          />
        )}
      </section>
    </ClubhouseFrame>
  )
}

import Link from 'next/link'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { clubhousePostHref } from '@/lib/community/channels'
import { IDEA_STATUS_COPY, type IdeaStatus } from '@/lib/community/ideas'
import { displayNameOf, timeAgo } from '@/lib/community/format'
import { formatBytes, type IdeaAttachmentView } from '@/lib/community/attachments'
import type { CommunityAuthor, IdeaView, PostSummary } from '@/lib/community/service'
import { AuthorLine, TagPills } from './CommunityBits'
import { UpvoteButton } from './IdeaClient'

/** Display pieces for League Lab ideas. Server components; the upvote is the only client part. */

export function IdeaStatusPill({ status }: { status: IdeaStatus | null }) {
  if (!status) return <span className="ch-pill">Open</span>
  const copy = IDEA_STATUS_COPY[status]
  return (
    <span title={copy.blurb} className="ch-pill ch-pill-tone" data-status={status}>
      <span aria-hidden>{copy.emoji}</span>
      {copy.label}
    </span>
  )
}

/** Sport · teams · draft, whichever were given. */
export function IdeaFacts({ idea }: { idea: IdeaView }) {
  const facts = [
    idea.teamSize ? `${idea.teamSize} teams` : null,
    idea.draftType ? `${idea.draftType} draft` : null,
  ].filter(Boolean) as string[]
  if (facts.length === 0) return null
  return (
    <span className="ch-mono text-xs capitalize" style={{ color: 'var(--faint)' }}>
      {facts.join(' · ')}
    </span>
  )
}

/** The public credit on a shipped idea. */
export function IdeaCredit({ idea, author, now }: { idea: IdeaView; author: CommunityAuthor; now: number }) {
  if (idea.status !== 'shipped') return null
  return (
    <div className="ch-credit">
      <span className="text-2xl" aria-hidden>
        🚀
      </span>
      <p className="text-sm">
        <strong className="font-extrabold">Shipped{idea.statusAt ? ` ${timeAgo(idea.statusAt, now)}` : ''}.</strong> Idea by{' '}
        <span className="font-bold">{displayNameOf(author)}</span> (@{author.username}). Thank you!
      </p>
    </div>
  )
}

export function IdeaCard({
  post,
  now,
  signedIn,
  viewerId,
  loginHref,
}: {
  post: PostSummary & { idea: IdeaView }
  now: number
  signedIn: boolean
  viewerId: string | null
  loginHref: string
}) {
  const { idea } = post
  return (
    <article data-channel="league-lab" className="ch-card ch-card-link ch-post flex gap-4">
      <UpvoteButton
        postId={post.id}
        initialUpvotes={idea.upvotes}
        initialVoted={idea.votedByMe}
        signedIn={signedIn}
        isAuthor={viewerId === post.author.id}
        loginHref={loginHref}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <IdeaStatusPill status={idea.status} />
          <TagPills tags={post.tags} />
          <IdeaFacts idea={idea} />
        </div>
        <Link href={clubhousePostHref(post.id)} className="block">
          <h3 className="ch-post-title">{censorProfanity(post.title)}</h3>
          {idea.hook && <p className="ch-post-excerpt">{censorProfanity(idea.hook)}</p>}
        </Link>
        <div className="ch-post-foot">
          <AuthorLine author={post.author} at={post.createdAt} now={now} />
          <span className="ch-count-chip">💬 {post.replyCount}</span>
        </div>
      </div>
    </article>
  )
}

/** Photos and PDFs on an idea. Photos show inline; every file opens full size in a new tab. */
export function IdeaAttachments({ files }: { files: IdeaAttachmentView[] }) {
  if (files.length === 0) return null
  const images = files.filter((f) => f.isImage)
  const docs = files.filter((f) => !f.isImage)
  return (
    <section aria-label="Attached files" className="ch-attachments" data-testid="idea-attachments">
      {images.length > 0 && (
        <div className="ch-attach-grid">
          {images.map((f) => (
            <a key={f.id} href={f.href} target="_blank" rel="noopener noreferrer" className="ch-attach-img" title={f.fileName}>
              {/* eslint-disable-next-line @next/next/no-img-element -- streamed from our own route, not optimisable */}
              <img src={f.href} alt={f.fileName} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <ul className="ch-attach-docs">
          {docs.map((f) => (
            <li key={f.id}>
              <a href={f.href} target="_blank" rel="noopener noreferrer" className="ch-attach-doc">
                <span aria-hidden>📄</span>
                <span className="min-w-0 truncate">{f.fileName}</span>
                <span className="ch-mono ml-auto shrink-0 whitespace-nowrap text-xs" style={{ color: 'var(--faint)' }}>
                  PDF · {formatBytes(f.byteSize)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

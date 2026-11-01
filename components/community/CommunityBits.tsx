import Link from 'next/link'
import '@/components/core-app/af-core.css'
import './clubhouse.css'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import {
  CLUBHOUSE_NAME,
  clubhouseChannelHref,
  clubhouseMemberHref,
  clubhousePostHref,
  getChannel,
} from '@/lib/community/channels'
import { IDEA_CHANNEL } from '@/lib/community/ideas'
import { displayNameOf, linkifySegments, timeAgo } from '@/lib/community/format'
import type { AuthorBadge, CommunityAuthor, PostSummary } from '@/lib/community/service'

/**
 * Display pieces for the Clubhouse. No hooks, no `'use client'`: they render on the
 * server and inside client components alike. The look lives in ./clubhouse.css, on top of
 * the af-core design system.
 */

/**
 * Plain text, as typed. Line breaks kept, URLs made clickable, swearing masked at render
 * (never at write — see censorProfanity.ts). There is no HTML path at all, so nothing a
 * stranger types can become markup.
 */
export function PostBody({ text, className = '' }: { text: string; className?: string }) {
  const segments = linkifySegments(censorProfanity(text))
  return (
    <div className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${className}`} style={{ color: 'var(--text)' }}>
      {segments.map((s, i) =>
        s.kind === 'link' ? (
          <a
            key={i}
            href={s.href}
            target="_blank"
            rel="nofollow ugc noopener noreferrer"
            className="underline underline-offset-2"
            style={{ color: 'var(--accent)' }}
          >
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </div>
  )
}

const BADGE_COPY: Record<AuthorBadge, { label: string; title: string }> = {
  staff: { label: 'AllFantasy', title: 'Part of the AllFantasy team' },
  commish: { label: 'Commish', title: 'Runs a league on AllFantasy' },
  shipped: { label: 'Idea Shipped', title: 'Pitched a League Lab idea that AllFantasy built' },
  new: { label: 'New', title: 'Joined in the last week. Say hi!' },
}

export function AuthorBadges({ badges }: { badges: AuthorBadge[] }) {
  if (badges.length === 0) return null
  return (
    <>
      {badges.map((b) => (
        <span key={b} title={BADGE_COPY[b].title} data-badge={b} className="ch-badge">
          {BADGE_COPY[b].label}
        </span>
      ))}
    </>
  )
}

/** A stable hue per username, so a person keeps their colour everywhere. */
export function avatarHue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h % 360
}

export function Avatar({ author, size = 36 }: { author: CommunityAuthor | null; size?: number }) {
  const name = author ? displayNameOf(author) : '?'
  if (author?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={author.avatarUrl} alt="" width={size} height={size} className="ch-avatar" style={{ width: size, height: size }} />
    )
  }
  const hue = avatarHue(author?.username ?? '?')
  return (
    <span
      aria-hidden
      className="ch-avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.42)),
        background: author
          ? `linear-gradient(140deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 65% 38%))`
          : 'var(--surface2)',
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function AuthorLine({
  author,
  at,
  edited,
  now,
}: {
  author: CommunityAuthor | null
  at: string
  edited?: boolean
  now: number
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
      {author ? (
        <Link href={clubhouseMemberHref(author.username)} className="font-bold hover:underline" style={{ color: 'var(--text)' }}>
          {displayNameOf(author)}
        </Link>
      ) : (
        <span className="font-bold" style={{ color: 'var(--text)' }}>
          Removed
        </span>
      )}
      {author && author.displayName && <span>@{author.username}</span>}
      {author && <AuthorBadges badges={author.badges} />}
      <span aria-hidden>·</span>
      <time dateTime={at}>{timeAgo(at, now)}</time>
      {edited && <span>(edited)</span>}
    </div>
  )
}

export function ChannelPill({ slug }: { slug: string }) {
  const channel = getChannel(slug)
  if (!channel) return null
  return (
    <Link href={clubhouseChannelHref(channel.slug)} data-channel={channel.slug} className="ch-pill ch-pill-tone">
      <span aria-hidden>{channel.emoji}</span>
      {channel.label}
    </Link>
  )
}

export function TagPills({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <>
      {tags.map((t) => (
        <span key={t} className="ch-pill ch-mono">
          {t}
        </span>
      ))}
    </>
  )
}

export function PostCard({ post, now, showChannel }: { post: PostSummary; now: number; showChannel?: boolean }) {
  const reactionTotal = post.reactions.reduce((n, r) => n + r.count, 0)
  const hot = post.replyCount >= 3 && now - Date.parse(post.lastActivityAt) < 24 * 60 * 60 * 1000
  return (
    <article data-channel={post.channel} className="ch-card ch-card-link ch-post">
      <div className="flex items-start gap-3">
        <Avatar author={post.author} size={40} />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {post.isPinned && <span className="ch-pill ch-pill-accent">📌 Pinned</span>}
            {hot && <span className="ch-pill" style={{ color: '#fb923c' }}>🔥 Hot</span>}
            {post.isLocked && <span className="ch-pill">🔒 Locked</span>}
            {post.idea && <span className="ch-pill ch-pill-accent">💡 Idea · ▲ {post.idea.upvotes}</span>}
            {showChannel && <ChannelPill slug={post.channel} />}
            <TagPills tags={post.tags} />
          </div>
          <Link href={clubhousePostHref(post.id)} className="block">
            <h3 className="ch-post-title">{censorProfanity(post.title)}</h3>
            {post.excerpt && <p className="ch-post-excerpt">{censorProfanity(post.excerpt)}</p>}
          </Link>
          <div className="ch-post-foot">
            <AuthorLine author={post.author} at={post.createdAt} now={now} />
            <div className="ch-counts">
              {reactionTotal > 0 && <span className="ch-count-chip">❤ {reactionTotal}</span>}
              <span className="ch-count-chip" title={post.replyCount > 0 ? `active ${timeAgo(post.lastActivityAt, now)}` : undefined}>
                💬 {post.replyCount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

const TOP_NAV = [
  { href: '/clubhouse', label: 'Home' },
  { href: clubhouseChannelHref(IDEA_CHANNEL), label: 'League Lab' },
  { href: '/clubhouse/game-day', label: 'Game Day' },
  { href: clubhouseChannelHref('commish-corner'), label: 'Commish Corner' },
  { href: clubhouseChannelHref('ask-the-founder'), label: 'Ask the Founder' },
]

/**
 * Every Clubhouse page renders inside this: the af-core theme root, a sticky top bar with
 * the main sections, and an optional breadcrumb. `active` marks the current section.
 */
export function ClubhouseFrame({
  children,
  crumbs,
  active,
  narrow,
  cta,
}: {
  children: React.ReactNode
  crumbs?: { href: string; label: string }[]
  active?: string
  narrow?: boolean
  cta?: React.ReactNode
}) {
  return (
    <div className="af-core ch">
      <header className="ch-top">
        <div className="ch-top-inner">
          <Link href="/clubhouse" className="ch-brand" aria-label={`${CLUBHOUSE_NAME} home`}>
            <span className="ch-brand-mark" aria-hidden>
              🏟️
            </span>
            {CLUBHOUSE_NAME}
          </Link>
          <nav aria-label="Clubhouse sections" className="ch-nav">
            {TOP_NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active === n.href ? 'page' : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ch-top-cta">{cta}</div>
        </div>
      </header>
      <div className={`ch-wrap ${narrow ? 'ch-narrow' : ''}`}>
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="ch-crumbs">
            <Link href="/">AllFantasy</Link>
            {crumbs.map((c) => (
              <span key={c.href} className="flex items-center gap-1.5">
                <span aria-hidden>/</span>
                <Link href={c.href}>{c.label}</Link>
              </span>
            ))}
          </nav>
        )}
        {children}
      </div>
    </div>
  )
}

/** The big title block at the top of a channel, profile or section page. */
export function PageHeader({
  eyebrow,
  title,
  sub,
  icon,
  channel,
  actions,
}: {
  eyebrow?: string
  title: React.ReactNode
  sub?: React.ReactNode
  icon?: string
  channel?: string
  actions?: React.ReactNode
}) {
  return (
    <header data-channel={channel} className="ch-hero mb-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          {icon && (
            <span className="ch-icon ch-icon-lg" aria-hidden>
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="ch-eyebrow" style={channel ? { color: 'var(--tone)' } : undefined}>{eyebrow}</p>}
            <h1 className="ch-h1 mt-1" style={{ fontSize: 'clamp(30px, 4.6vw, 46px)' }}>
              {title}
            </h1>
            {sub && <p className="ch-hero-sub" style={{ marginTop: 10 }}>{sub}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export function EmptyState({
  title,
  body,
  action,
  icon = '✨',
}: {
  title: string
  body: string
  action?: React.ReactNode
  icon?: string
}) {
  return (
    <div className="ch-empty">
      <div className="ch-empty-icon" aria-hidden>
        {icon}
      </div>
      <p className="mt-3 text-[17px] font-extrabold" style={{ color: 'var(--text)' }}>
        {title}
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: 'var(--muted)' }}>
        {body}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}

export function loginHref(callbackPath: string): string {
  return `/login?callbackUrl=${encodeURIComponent(callbackPath)}`
}

export function PrimaryButtonLink({ href, children, small }: { href: string; children: React.ReactNode; small?: boolean }) {
  return (
    <Link href={href} className={`ch-btn ch-btn-primary ${small ? 'ch-btn-sm' : ''}`}>
      {children}
    </Link>
  )
}

export function GhostButtonLink({ href, children, small }: { href: string; children: React.ReactNode; small?: boolean }) {
  return (
    <Link href={href} className={`ch-btn ch-btn-ghost ${small ? 'ch-btn-sm' : ''}`}>
      {children}
    </Link>
  )
}


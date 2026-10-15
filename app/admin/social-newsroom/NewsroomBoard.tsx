"use client"

import Link from "next/link"
import { createContext, useContext, useMemo, useRef, useState, useTransition } from "react"

import type { NewsroomGame, NewsroomHighlight, NewsroomStory } from "@/lib/social-newsroom/loadNewsroom"
import { easternTime, SOCIAL_CHAR_LIMITS, SOCIAL_PLATFORM_LABELS, xLength, type SocialPost } from "@/lib/social-newsroom/postBuilder"
import { draftFunVariants, postToX } from "./actions"

/** The X account "Post to X" would post to, or null when the signed-in account has none connected. */
const XAccountContext = createContext<{ handle: string } | null>(null)

const KIND_LABELS: Record<string, string> = {
  trade: "Trade",
  signing: "Signing",
  release: "Roster move",
  coaching: "Coaching",
  suspension: "Suspension",
  injury: "Injury",
  retirement: "Retirement",
}

function timeAgo(iso: string | null): string {
  if (!iso) return ""
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          setDone(false)
        }
      }}
      className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs font-bold text-cyan-100 hover:border-cyan-300/60"
    >
      {done ? "Copied ✓" : label}
    </button>
  )
}

/**
 * One tap, one confirm, one post. The request id is made once per box, so a double tap or a retry
 * after a timeout returns the first tweet instead of posting twice.
 */
function PostToXButton({ text, fits }: { text: string; fits: boolean }) {
  const account = useContext(XAccountContext)
  const requestId = useRef<string | null>(null)
  const [pending, start] = useTransition()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!account) {
    return (
      <Link href="/core/week" className="text-xs text-white/45 underline" title="Connect an X account on the Weekly page to post from here">
        Connect X
      </Link>
    )
  }
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-xs font-bold text-emerald-300 underline">
        Posted ✓ View
      </a>
    )
  }
  return (
    <span className="flex items-center gap-2">
      {error && <span className="max-w-[16rem] text-xs text-rose-300">{error}</span>}
      <button
        type="button"
        disabled={pending || !fits}
        title={fits ? `Post to X as @${account.handle}` : "Too long for X"}
        onClick={() => {
          if (!window.confirm(`Post this to X as @${account.handle} now?\n\n${text}`)) return
          requestId.current ??= crypto.randomUUID()
          setError(null)
          start(async () => {
            const res = await postToX({ requestId: requestId.current!, text })
            if (res.ok) setUrl(res.url)
            else setError(res.error)
          })
        }}
        className="rounded-lg border border-white/30 bg-white px-2.5 py-1 text-xs font-bold text-[#020817] hover:bg-white/90 disabled:opacity-40"
      >
        {pending ? "Posting…" : `Post to @${account.handle}`}
      </button>
    </span>
  )
}

function PostBox({ post }: { post: SocialPost }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-bold text-white/80">
          {SOCIAL_PLATFORM_LABELS[post.platform]} · {post.tone === "viral" ? "viral 🔁" : post.tone}
        </span>
        <span className="flex items-center gap-2">
          <span className={post.withinLimit ? "text-white/45" : "text-rose-300"}>
            {post.charCount}/{SOCIAL_CHAR_LIMITS[post.platform]}
          </span>
          <CopyButton text={post.text} />
          {post.platform === "x" && <PostToXButton text={post.text} fits={post.withinLimit} />}
        </span>
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm text-white/85">{post.text}</pre>
    </div>
  )
}

function MediaStrip({ story }: { story: NewsroomStory }) {
  const items: Array<{ src: string; label: string; round?: boolean }> = []
  for (const t of story.teams) if (t.logo) items.push({ src: t.logo, label: t.name })
  for (const p of story.players) if (p.headshot) items.push({ src: p.headshot, label: p.name, round: true })
  if (items.length === 0 && !story.articleImage) return null
  return (
    <div className="flex flex-wrap items-end gap-3">
      {story.articleImage && (
        <a
          href={story.articleImage}
          target="_blank"
          rel="noreferrer"
          className="block"
          title="Article photo (the publisher's — share via the link card)"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={story.articleImage} alt="" className="h-20 w-32 rounded-lg object-cover" loading="lazy" />
        </a>
      )}
      {items.map((m) => (
        <a
          key={m.src}
          href={m.src}
          target="_blank"
          rel="noreferrer"
          download
          className="flex flex-col items-center gap-1"
          title={`Open ${m.label}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={m.src}
            alt={m.label}
            className={`h-14 w-14 bg-white/5 object-contain ${m.round ? "rounded-full object-cover" : "rounded-lg p-1"}`}
            loading="lazy"
          />
          <span className="max-w-[5.5rem] truncate text-[11px] text-white/55">{m.label}</span>
        </a>
      ))}
    </div>
  )
}

function StoryCard({ story }: { story: NewsroomStory }) {
  const [open, setOpen] = useState(false)
  const [ai, setAi] = useState<string[] | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const c = story.classification
  const xPosts = story.posts.filter((p) => p.platform === "x")
  const others = story.posts.filter((p) => p.platform !== "x")

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide">
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/75">{story.sport}</span>
        {c && <span className="rounded-full bg-rose-400/15 px-2 py-0.5 text-rose-200">Breaking · {KIND_LABELS[c.kind] ?? c.kind}</span>}
        {c?.confidence === "report" && (
          <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-amber-200">Report — sourced, not announced</span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 ${story.corroboratedBy > 1 ? "bg-emerald-300/15 text-emerald-200" : "bg-white/5 text-white/50"}`}
        >
          {story.corroboratedBy > 1 ? `${story.corroboratedBy} reports` : "1 source"}
        </span>
        <span className="text-white/40">{timeAgo(story.publishedAt)}</span>
      </div>
      <div>
        <h2 className="text-lg font-black leading-snug">{story.title}</h2>
        {story.description && story.description !== story.title && <p className="mt-1 text-sm text-white/65">{story.description}</p>}
        <a href={story.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-bold text-cyan-300">
          Read on {story.outlet.name} ↗
        </a>
      </div>
      <MediaStrip story={story} />
      <div className="grid gap-2 sm:grid-cols-2">
        {xPosts.map((p, i) => (
          <PostBox key={`x-${i}`} post={p} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-sm font-bold text-cyan-300">
          {open ? "Hide" : "Show"} Threads · Instagram · Facebook · TikTok
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setAiError(null)
              const r = await draftFunVariants({
                sport: story.sport,
                title: story.title,
                description: story.description,
                url: story.url,
                outletName: story.outlet.name,
                outletHandle: story.outlet.handle,
              })
              if (r.ok) setAi(r.variants)
              else setAiError(r.error)
            })
          }
          className="text-sm font-bold text-fuchsia-300 disabled:opacity-50"
        >
          {pending ? "Writing…" : "✨ More fun versions (AI)"}
        </button>
      </div>
      {open && (
        <div className="grid gap-2 sm:grid-cols-2">
          {others.map((p, i) => (
            <PostBox key={`${p.platform}-${i}`} post={p} />
          ))}
        </div>
      )}
      {aiError && <p className="text-sm text-rose-300">{aiError}</p>}
      {ai && (
        <div className="grid gap-2 sm:grid-cols-3">
          {ai.map((text, i) => (
            <div key={i} className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-300/[0.06] p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-bold text-fuchsia-100">AI draft — check the facts</span>
                <span className="flex items-center gap-2">
                  <CopyButton text={text} />
                  <PostToXButton text={text} fits={xLength(text) <= SOCIAL_CHAR_LIMITS.x} />
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-white/85">{text}</pre>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

function HighlightCard({ h }: { h: NewsroomHighlight }) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex gap-3">
        {h.thumbnail && (
          <a href={h.videoUrl} target="_blank" rel="noreferrer" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={h.thumbnail} alt="" className="h-20 w-36 rounded-lg object-cover" loading="lazy" />
          </a>
        )}
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-white/55">
            {h.sport} · {timeAgo(h.startTime)}
          </div>
          <h3 className="font-black leading-snug">{h.title}</h3>
          {h.homeScore != null && h.awayScore != null && (
            <p className="text-sm text-white/65">
              {h.awayTeam} {h.awayScore}, {h.homeTeam} {h.homeScore}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            <a href={h.videoUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-cyan-300">
              Watch on YouTube ↗
            </a>
            <CopyButton text={h.videoUrl} label="Copy video link" />
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {h.posts.map((p, i) => (
          <PostBox key={i} post={p} />
        ))}
      </div>
    </article>
  )
}

function TeamMark({ name, logo }: { name: string; logo: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-8 w-8 shrink-0 object-contain" loading="lazy" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="truncate font-bold">{name}</span>
    </span>
  )
}

function GameCard({ g }: { g: NewsroomGame }) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide">
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/75">{g.sport}</span>
        {g.final ? (
          <span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-emerald-200">Final</span>
        ) : (
          <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 text-cyan-100">{easternTime(g.startTime)}</span>
        )}
        {g.scoreCheck === "confirmed" ? (
          <span className="rounded-full bg-emerald-300/10 px-2 py-0.5 normal-case text-emerald-200/90">Score confirmed by 2 sources</span>
        ) : g.scoreCheck === "single" ? (
          <span className="rounded-full bg-amber-300/15 px-2 py-0.5 normal-case text-amber-200">
            1 source: check the score before posting
          </span>
        ) : null}
        {g.venue ? <span className="normal-case text-white/45">{g.venue}</span> : null}
      </div>
      {g.scoreCheck === "conflict" ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-300/[0.08] p-2 text-sm text-rose-100" data-testid="game-score-conflict">
          Score unconfirmed: our data providers disagree on this result, so no posts were written. Check the official box score first.
        </p>
      ) : null}
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
        <TeamMark name={g.awayTeam} logo={g.awayLogo} />
        <span className="text-lg font-black tabular-nums">{g.final ? g.awayScore : ""}</span>
        <TeamMark name={`@ ${g.homeTeam}`} logo={g.homeLogo} />
        <span className="text-lg font-black tabular-nums">{g.final ? g.homeScore : ""}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {g.posts.map((p, i) => (
          <PostBox key={i} post={p} />
        ))}
      </div>
    </article>
  )
}

export function NewsroomBoard({
  stories,
  highlights,
  games = [],
  xAccount = null,
}: {
  stories: NewsroomStory[]
  highlights: NewsroomHighlight[]
  games?: NewsroomGame[]
  xAccount?: { handle: string } | null
}) {
  const [tab, setTab] = useState<"news" | "breaking" | "games" | "highlights">("news")
  const shown = useMemo(() => (tab === "breaking" ? stories.filter((s) => s.classification) : stories), [stories, tab])
  const breakingCount = stories.filter((s) => s.classification).length

  return (
    <XAccountContext.Provider value={xAccount}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-white/55">
          {xAccount
            ? `"Post to @${xAccount.handle}" posts to that X account after you confirm. Nothing posts on its own.`
            : "To post from here, connect an X account on the Weekly page (/core/week) while signed in to the app."}
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              ["news", `All stories (${stories.length})`],
              ["breaking", `Breaking (${breakingCount})`],
              ["games", `Tonight's games (${games.length})`],
              ["highlights", `Highlight videos (${highlights.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-xl px-3 py-1.5 font-bold ${tab === id ? "bg-white text-[#020817]" : "bg-white/10 text-white/75"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <details className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-sm text-amber-50/85">
          <summary className="cursor-pointer font-bold text-amber-100">Posting rules — read once</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Only trusted outlets appear here, and rumours, betting, rankings and question headlines are filtered out. Still read the
              article before posting.
            </li>
            <li>
              &quot;Report&quot; means the outlet credits sources and the team has not announced it yet. Keep the word &quot;report&quot; in
              the post.
            </li>
            <li>Every post keeps the source credit and the link. Do not remove them.</li>
            <li>
              Viral posts ask the audience questions (polls, predictions, &quot;wrong answers only&quot;). They state nothing beyond the
              schedule or the final score, so keep it that way if you edit one. Never add a stat or a record you have not checked.
            </li>
            <li>
              Videos: post the YouTube link and X, Threads and Facebook play the official clip inline. Do not download and re-upload league
              footage, because the leagues file copyright strikes against accounts that do.
            </li>
            <li>
              Photos: posting the article link shows the publisher&apos;s own preview image. Use logos and headshots for your own graphics,
              editorially.
            </li>
          </ul>
        </details>

        {tab === "games" ? (
          games.length === 0 ? (
            <p className="text-sm text-white/55">
              No games on the schedule for the next 18 hours, and no finals from today, for this filter.
            </p>
          ) : (
            games.map((g) => <GameCard key={g.id} g={g} />)
          )
        ) : tab === "highlights" ? (
          highlights.length === 0 ? (
            <p className="text-sm text-white/55">No highlight videos stored for recent games in this sport yet.</p>
          ) : (
            highlights.map((h) => <HighlightCard key={h.id} h={h} />)
          )
        ) : shown.length === 0 ? (
          <p className="text-sm text-white/55">No stories from trusted outlets in the last 36 hours for this filter.</p>
        ) : (
          shown.map((s) => <StoryCard key={s.id} story={s} />)
        )}
      </div>
    </XAccountContext.Provider>
  )
}

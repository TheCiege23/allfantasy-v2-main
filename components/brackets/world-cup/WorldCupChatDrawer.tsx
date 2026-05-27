"use client"

/**
 * WorldCupChatDrawer
 *
 * Floating chat bubble + slide-up drawer for World Cup pool pages.
 * Available from every tab inside /brackets/world-cup/[challengeId].
 *
 * Tabs:
 *   1. Pool Chat  — full message thread with GIF/image/poll/emoji support
 *   2. Chimmy AI  — dedicated private Chimmy interface (AF Pro gated)
 *   3. DMs        — polished "coming soon" (platform DMs not pool-specific yet)
 *
 * Layout:
 *   Mobile  : bottom sheet (h-[85dvh]), slides up from bottom-0
 *   Desktop : fixed panel (w-[400px] h-[600px]) anchored bottom-left
 *
 * Safe area: clears mobile bottom nav (56px) + env(safe-area-inset-bottom)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import Link from "next/link"
import {
  BarChart3,
  Bold,
  ExternalLink,
  Film,
  ImageIcon,
  Italic,
  Loader2,
  Lock,
  MessageSquare,
  Send,
  Smile,
  Sparkles,
  Strikethrough,
  Underline,
  X,
} from "lucide-react"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import {
  parseWorldCupChatRichText,
  sanitizeWorldCupChatMessage,
  type WorldCupChatColor,
  type WorldCupChatFont,
  type WorldCupChatRichTextSegment,
} from "@/lib/world-cup/worldCupChatRichText"
import { resolveWorldCupEntitlementSummary } from "@/lib/world-cup/worldCupEntitlements"

// ─── Local types (mirror WorldCupBracketShell — same API shape) ─────────────

type DrawerTab = "chat" | "chimmy" | "dms"

type WcChatMsg = {
  id: string
  userId: string | null
  authorName: string
  authorAvatarUrl: string | null
  body: string
  messageType: string
  gif?: WcGif | null
  image?: WcImage | null
  poll?: WcPoll | null
  visibility: string
  targetUserId: string | null
  mentions: unknown[]
  createdAt: string
  isOwnMessage: boolean
  isPrivate: boolean
}

type WcGif = {
  id: string
  title: string
  previewUrl: string
  gifUrl: string
  width: number
  height: number
  provider: "klipy" | "tenor" | "giphy"
}

type WcImage = {
  assetId: string
  publicId: string
  secureUrl: string
  width: number
  height: number
  format: string
  bytes: number
  provider: "cloudinary"
}

type WcPollOption = {
  id: string
  label: string
  votes: number
  percentage: number
}

type WcPoll = {
  question: string
  options: WcPollOption[]
  currentUserVote: string | null
  totalVotes: number
  closed: boolean
  closedAt: string | null
  createdByUserId: string | null
  createdAt: string | null
}

type ComposerPanel = "gif" | "poll" | "image" | null

// ─── Constants ───────────────────────────────────────────────────────────────

const EMOJI_CATS = {
  Reactions: [
    "😀","😂","🤣","😊","😍","🥳","🎉","🔥","👏","💯",
    "😭","😱","🤯","😤","👀","🤔","💪","🙏","❤️","✨",
  ],
  Sports: [
    "⚽","🏆","🥇","🎯","🏅","🥅","⚡","🏃","💨","🎊",
    "🥊","🎽","🌟","🏟️","💥","🏋️","🤾","🎲","🥵","👟",
  ],
  World: [
    "🌎","🌍","🌏","🇺🇸","🇧🇷","🇦🇷","🇫🇷","🇩🇪","🇪🇸","🇵🇹",
    "🇮🇹","🇯🇵","🇰🇷","🇲🇽","🇬🇧","🇳🇱","🇸🇦","🇸🇪","🇧🇪","🇭🇷",
  ],
  Celebration: [
    "🎈","🎆","🎇","🥂","🍾","🎁","🎀","🎊","🎉","🪅",
    "🥳","💃","🕺","🎶","🎵","🎤","🪩","🪄","🌈","🎯",
  ],
  Banter: [
    "😏","😈","👿","💀","🤡","👎","💔","😹","🐢","🫠",
    "😵","🤦","🤷","👻","💩","🦆","🫡","🤌","😬","😤",
  ],
} as const

const COLOR_OPTIONS: Array<{ value: WorldCupChatColor; label: string }> = [
  { value: "default", label: "Default" },
  { value: "af-blue", label: "AF Blue" },
  { value: "red", label: "Red" },
  { value: "amber", label: "Amber" },
  { value: "green", label: "Green" },
  { value: "purple", label: "Purple" },
]

const FONT_OPTIONS: Array<{ value: WorldCupChatFont; label: string }> = [
  { value: "default", label: "Default" },
  { value: "clean", label: "Clean" },
  { value: "sport", label: "Sport" },
  { value: "mono", label: "Mono" },
]

// Maps AF locale to Google Translate target language code
function gtLang(locale: string): string {
  if (locale === "es") return "es"
  if (locale === "zh") return "zh-TW"
  if (locale === "fil") return "tl"
  if (locale === "vi") return "vi"
  return "en"
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function RichSegments({
  segments,
  className,
}: {
  segments: WorldCupChatRichTextSegment[]
  className?: string
}) {
  function cls(seg: WorldCupChatRichTextSegment) {
    const colorMap: Record<WorldCupChatColor, string> = {
      default: "",
      "af-blue": "text-cyan-200",
      red: "text-rose-300",
      amber: "text-amber-300",
      green: "text-emerald-300",
      purple: "text-purple-300",
    }
    const fontMap: Record<WorldCupChatFont, string> = {
      default: "",
      clean: "font-sans tracking-normal",
      sport: "font-black uppercase tracking-wide",
      mono: "font-mono",
    }
    return [
      seg.marks.bold ? "font-black" : "",
      seg.marks.italic ? "italic" : "",
      seg.marks.underline ? "underline underline-offset-2" : "",
      seg.marks.strike ? "line-through" : "",
      colorMap[seg.marks.color ?? "default"],
      fontMap[seg.marks.font ?? "default"],
    ]
      .filter(Boolean)
      .join(" ")
  }
  return (
    <p className={className}>
      {segments.map((seg, i) => (
        <span key={i} className={cls(seg)}>
          {seg.text}
        </span>
      ))}
    </p>
  )
}

function GifPreview({ gif, compact = false }: { gif: WcGif; compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "mt-2 max-w-[200px] overflow-hidden rounded-lg border border-white/10 bg-black/25"
          : "overflow-hidden rounded-lg border border-white/10 bg-black/25"
      }
    >
      <img
        src={gif.previewUrl}
        alt={gif.title || "GIF"}
        className="max-h-40 w-full object-cover"
      />
      <p className="flex items-center justify-between gap-2 px-2 py-0.5 text-[10px] text-white/35">
        <span className="truncate">{gif.title || "GIF"}</span>
        <span className="uppercase">{gif.provider}</span>
      </p>
    </div>
  )
}

function ImagePreview({ image, compact = false }: { image: WcImage; compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "mt-2 max-w-[200px] overflow-hidden rounded-lg border border-white/10 bg-black/25"
          : "overflow-hidden rounded-lg border border-white/10 bg-black/25"
      }
    >
      <img
        src={image.secureUrl}
        alt="Chat image"
        className="max-h-48 w-full object-cover"
      />
      <p className="px-2 py-0.5 text-[10px] text-white/35">
        {image.format.toUpperCase()} · {Math.round(image.bytes / 1024)}KB
      </p>
    </div>
  )
}

function PollMessage({
  poll,
  messageId,
  isVoting,
  onVote,
}: {
  poll: WcPoll
  messageId: string
  isVoting: boolean
  onVote: (optionId: string) => void
}) {
  return (
    <div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-2.5">
      <p className="text-xs font-black text-white">{poll.question}</p>
      <div className="mt-2 space-y-1.5">
        {poll.options.map((opt) => {
          const selected = poll.currentUserVote === opt.id
          return (
            <button
              key={`${messageId}-${opt.id}`}
              type="button"
              onClick={() => onVote(opt.id)}
              disabled={isVoting || poll.closed}
              className={[
                "w-full overflow-hidden rounded-lg border bg-black/25 text-left text-[11px] transition disabled:cursor-not-allowed disabled:opacity-65",
                selected ? "border-cyan-300/70" : "border-white/10 hover:border-cyan-300/35",
              ].join(" ")}
            >
              <span className="relative block">
                <span
                  className="absolute inset-y-0 left-0 bg-cyan-300/15"
                  style={{ width: `${opt.percentage}%` }}
                  aria-hidden
                />
                <span className="relative flex items-center justify-between gap-2 px-2.5 py-1.5">
                  <span className="font-bold text-white/75">{opt.label}</span>
                  <span className="tabular-nums text-[10px] font-black text-white/55">
                    {opt.votes}v · {opt.percentage}%
                  </span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-white/35">
        {poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}
        {poll.currentUserVote ? " · Voted" : ""}
        {poll.closed ? " · Closed" : ""}
      </p>
    </div>
  )
}

/** 100-emoji picker organized by category. */
function EmojiPicker({
  onInsert,
  onClose,
  t,
}: {
  onInsert: (e: string) => void
  onClose: () => void
  t: ReturnType<typeof makeWcT>
}) {
  const cats = Object.keys(EMOJI_CATS) as Array<keyof typeof EMOJI_CATS>
  const catKeys: Record<keyof typeof EMOJI_CATS, string> = {
    Reactions: t("wc.chat.emoji.catReactions"),
    Sports: t("wc.chat.emoji.catSports"),
    World: t("wc.chat.emoji.catWorld"),
    Celebration: t("wc.chat.emoji.catCelebration"),
    Banter: t("wc.chat.emoji.catBanter"),
  }
  const [active, setActive] = useState<keyof typeof EMOJI_CATS>("Reactions")
  return (
    <div
      role="dialog"
      aria-label={t("wc.chat.emoji.open")}
      className="absolute bottom-full left-0 z-10 mb-1.5 w-[260px] overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 shadow-2xl"
    >
      {/* Category tabs */}
      <div className="flex gap-0 overflow-x-auto border-b border-white/10 scrollbar-none">
        {cats.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActive(cat)}
            className={[
              "shrink-0 min-h-9 px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-colors touch-manipulation",
              active === cat
                ? "border-b-2 border-cyan-300 text-white"
                : "text-white/40 hover:text-white/70",
            ].join(" ")}
          >
            {catKeys[cat]}
          </button>
        ))}
      </div>
      {/* Emoji grid */}
      <div className="grid grid-cols-6 gap-0 p-2">
        {EMOJI_CATS[active].map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onInsert(emoji)
              onClose()
            }}
            aria-label={`Insert ${emoji}`}
            className="flex min-h-11 items-center justify-center rounded-lg text-lg transition-colors hover:bg-white/[0.08] touch-manipulation"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}

/** GIF search panel (drawer variant). */
function GifSearchPanel({
  challengeId,
  onSelect,
  onClose,
}: {
  challengeId: string
  onSelect: (gif: WcGif) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<WcGif[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function search() {
    const q = query.trim()
    if (!q) { setResults([]); return }
    setLoading(true); setErr(null)
    try {
      const res = await fetch(
        `/api/brackets/world-cup/${challengeId}/chat?action=gifs&q=${encodeURIComponent(q)}&limit=12`,
        { cache: "no-store" }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "GIF search failed")
      setResults(Array.isArray(data.gifs) ? data.gifs : [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : "GIF search failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-black/30 p-2.5">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search() } }}
          maxLength={64}
          placeholder="Search GIFs…"
          className="min-h-9 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-cyan-300/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={loading || !query.trim()}
          className="min-h-9 touch-manipulation rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 text-[11px] font-black text-white/90 disabled:opacity-45"
        >
          {loading ? "…" : "Go"}
        </button>
        <button type="button" onClick={onClose} className="min-h-9 touch-manipulation rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-white/50 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {err && <p className="mt-1.5 text-[11px] text-rose-400">{err}</p>}
      {results.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
          {results.map((gif) => (
            <button
              key={`${gif.provider}-${gif.id}`}
              type="button"
              onClick={() => { onSelect(gif); onClose() }}
              className="overflow-hidden rounded-lg border border-white/10 bg-black/30 touch-manipulation"
            >
              <img src={gif.previewUrl} alt={gif.title || "GIF"} className="h-16 w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Image upload panel (drawer variant). */
function ImageUploadPanel({
  challengeId,
  onUploaded,
  onClose,
}: {
  challengeId: string
  onUploaded: (image: WcImage) => void
  onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleFile(file: File) {
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setErr("Only PNG, JPEG, WebP, and GIF are allowed.")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr("Image must be under 5 MB.")
      return
    }
    setLoading(true); setErr(null)
    try {
      const form = new FormData()
      form.set("file", file)
      const res = await fetch(
        `/api/brackets/world-cup/${challengeId}/chat?action=upload_image`,
        { method: "POST", body: form }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Upload failed")
      if (!data.image) throw new Error("Missing image in response")
      onUploaded(data.image as WcImage)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-black/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex min-h-9 touch-manipulation cursor-pointer items-center gap-1.5 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 text-[11px] font-black text-white/90">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
          {loading ? "Uploading…" : "Choose Image"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            disabled={loading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = "" }}
          />
        </label>
        <button type="button" onClick={onClose} className="min-h-9 touch-manipulation rounded-lg border border-white/10 px-2.5 text-white/50 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 text-[10px] text-white/35">PNG, JPEG, WebP, GIF · max 5 MB · Cloudinary</p>
      {err && <p className="mt-1.5 text-[11px] text-rose-400">{err}</p>}
    </div>
  )
}

/** Poll creation panel (drawer variant). */
function PollComposerPanel({
  challengeId,
  onCreated,
  onClose,
}: {
  challengeId: string
  onCreated: (msg: WcChatMsg) => void
  onClose: () => void
}) {
  const [question, setQuestion] = useState("")
  const [options, setOptions] = useState(["", ""])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    const q = question.trim()
    const opts = options.map((o) => o.trim()).filter(Boolean)
    if (!q) { setErr("Question required."); return }
    if (opts.length < 2 || opts.length > 6) { setErr("Need 2–6 options."); return }
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) { setErr("Options must be unique."); return }
    setLoading(true); setErr(null)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_poll", question: q, options: opts }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Poll creation failed")
      if (data.message) onCreated(data.message as WcChatMsg)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Poll creation failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-black/30 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-black text-white/75">Create Poll</p>
        <button type="button" onClick={onClose} className="inline-flex min-h-9 min-w-9 touch-manipulation items-center justify-center rounded-lg text-white/40 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        maxLength={180}
        placeholder="Poll question…"
        className="min-h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-cyan-300/50 focus:outline-none"
      />
      <div className="mt-1.5 space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              value={opt}
              onChange={(e) => setOptions((prev) => prev.map((v, j) => j === i ? e.target.value : v))}
              maxLength={80}
              placeholder={`Option ${i + 1}`}
              className="min-h-9 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-cyan-300/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setOptions((prev) => prev.length <= 2 ? prev : prev.filter((_, j) => j !== i))}
              disabled={options.length <= 2}
              className="min-h-9 touch-manipulation rounded-lg border border-white/10 px-2 text-[10px] text-white/40 disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOptions((prev) => prev.length < 6 ? [...prev, ""] : prev)}
          disabled={options.length >= 6}
          className="min-h-9 touch-manipulation rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-black text-white/55 disabled:opacity-35"
        >
          + Option
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={loading}
          className="min-h-9 touch-manipulation rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 text-[11px] font-black text-white/90 disabled:opacity-45"
        >
          {loading ? "Creating…" : "Create Poll"}
        </button>
      </div>
      {err && <p className="mt-1.5 text-[11px] text-rose-400">{err}</p>}
    </div>
  )
}

/** Single message row with avatar, name, time, body, and translate link. */
function ChatMessageRow({
  msg,
  language,
  isVoting,
  onVote,
  t,
}: {
  msg: WcChatMsg
  language: string
  isVoting: boolean
  onVote: (messageId: string, optionId: string) => void
  t: ReturnType<typeof makeWcT>
}) {
  const initials = getInitials(msg.authorName)
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
  const segments = useMemo(() => parseWorldCupChatRichText(msg.body), [msg.body])
  const translateUrl = `https://translate.google.com/?sl=auto&tl=${gtLang(language)}&text=${encodeURIComponent(msg.body)}&op=translate`

  return (
    <div
      className={[
        "group flex gap-2.5 rounded-xl border px-3 py-2.5",
        msg.isPrivate
          ? "border-purple-300/20 bg-purple-400/[0.08]"
          : msg.isOwnMessage
          ? "border-cyan-300/15 bg-cyan-300/[0.04]"
          : "border-white/[0.07] bg-white/[0.03]",
      ].join(" ")}
    >
      {/* Avatar */}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.08] text-[10px] font-black text-white/70">
        {msg.authorAvatarUrl ? (
          <img src={msg.authorAvatarUrl} alt={initials} className="h-full w-full rounded-full object-cover" />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-black text-white/80">{msg.authorName}</span>
          <span className="text-[10px] text-white/25">{time}</span>
          {msg.isPrivate && (
            <span className="text-[9px] font-bold uppercase tracking-wide text-purple-300/70">
              {t("wc.chat.privateLabel")}
            </span>
          )}
        </div>
        <RichSegments
          segments={segments}
          className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-5 text-white/70"
        />
        {msg.gif && <GifPreview gif={msg.gif} compact />}
        {msg.image && <ImagePreview image={msg.image} compact />}
        {msg.poll && (
          <PollMessage
            poll={msg.poll}
            messageId={msg.id}
            isVoting={isVoting}
            onVote={(optId) => onVote(msg.id, optId)}
          />
        )}
        {/* Translate link — user-initiated, opens Google Translate in new tab */}
        {msg.body.trim() && (
          <a
            href={translateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[9px] text-white/25 opacity-0 transition-opacity hover:text-white/60 group-hover:opacity-100 focus:opacity-100"
            aria-label={t("wc.chat.msg.translate")}
          >
            <ExternalLink className="h-2.5 w-2.5" aria-hidden />
            {t("wc.chat.msg.translate")}
          </a>
        )}
      </div>
    </div>
  )
}

// ─── Pool Chat Tab ────────────────────────────────────────────────────────────

function PoolChatTab({
  challengeId,
  language,
  t,
}: {
  challengeId: string
  language: string
  t: ReturnType<typeof makeWcT>
}) {
  const [messages, setMessages] = useState<WcChatMsg[]>([])
  const [body, setBody] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedGif, setSelectedGif] = useState<WcGif | null>(null)
  const [selectedImage, setSelectedImage] = useState<WcImage | null>(null)
  const [panel, setPanel] = useState<ComposerPanel>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [votingId, setVotingId] = useState<string | null>(null)
  const msgEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadChat = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load chat")
      setMessages(Array.isArray(data.messages) ? data.messages : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load chat")
    } finally {
      setLoading(false)
    }
  }, [challengeId])

  useEffect(() => { void loadChat() }, [loadChat])

  // Auto-scroll to newest message
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function send() {
    const trimmed = body.trim()
    if (!trimmed && !selectedGif && !selectedImage) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: trimmed || (selectedGif ? "GIF" : "Image"),
          gif: selectedGif ?? undefined,
          image: selectedImage ?? undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not send message")
      const newMsgs: WcChatMsg[] = Array.isArray(data.messages) && data.messages.length > 0
        ? data.messages
        : data.message
        ? [data.message]
        : []
      setMessages((prev) => [...prev, ...newMsgs])
      setBody("")
      setSelectedGif(null)
      setSelectedImage(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send message")
    } finally {
      setSending(false)
    }
  }

  async function vote(messageId: string, optionId: string) {
    setVotingId(messageId)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poll_vote", messageId, optionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Vote failed")
      if (data.message) {
        setMessages((prev) => prev.map((m) => m.id === messageId ? data.message as WcChatMsg : m))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vote failed")
    } finally {
      setVotingId(null)
    }
  }

  const richPreview = useMemo(() => parseWorldCupChatRichText(body), [body])
  const showPreview = sanitizeWorldCupChatMessage(body).trim().length > 0

  return (
    <div className="flex h-full flex-col">
      {/* ── Messages ─── */}
      <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-white/40">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("wc.chat.loading")}
          </div>
        ) : messages.length === 0 ? (
          <div
            data-testid="wc-drawer-chat-empty"
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center"
          >
            <MessageSquare className="h-7 w-7 text-white/20" aria-hidden />
            <p className="text-sm font-black text-white/60">{t("wc.chat.empty.headline")}</p>
            <p className="max-w-[200px] text-xs leading-5 text-white/35">{t("wc.chat.empty.body")}</p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessageRow
              key={msg.id}
              msg={msg}
              language={language}
              isVoting={votingId === msg.id}
              onVote={vote}
              t={t}
            />
          ))
        )}
        <div ref={msgEndRef} />
      </div>

      {/* ── Composer ─── */}
      <div className="border-t border-white/10 bg-zinc-950/80 px-3 pb-[env(safe-area-inset-bottom,0px)] pt-2.5">
        {/* Attachment previews */}
        {selectedGif && (
          <div className="mb-2 flex items-start gap-2">
            <GifPreview gif={selectedGif} compact />
            <button
              type="button"
              onClick={() => setSelectedGif(null)}
              className="mt-1 rounded border border-white/10 p-0.5 text-white/40 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {selectedImage && (
          <div className="mb-2 flex items-start gap-2">
            <ImagePreview image={selectedImage} compact />
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="mt-1 rounded border border-white/10 p-0.5 text-white/40 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {/* Expanded panels */}
        {panel === "gif" && (
          <GifSearchPanel
            challengeId={challengeId}
            onSelect={(gif) => { setSelectedGif(gif); setPanel(null) }}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "image" && (
          <ImageUploadPanel
            challengeId={challengeId}
            onUploaded={(img) => { setSelectedImage(img); setPanel(null) }}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "poll" && (
          <PollComposerPanel
            challengeId={challengeId}
            onCreated={(msg) => { setMessages((prev) => [...prev, msg]); setPanel(null) }}
            onClose={() => setPanel(null)}
          />
        )}
        {/* Rich text preview */}
        {showPreview && panel === null && (
          <div className="mb-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px]">
            <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wide text-white/25">Preview</p>
            <RichSegments
              segments={richPreview}
              className="whitespace-pre-wrap break-words leading-5 text-white/60"
            />
          </div>
        )}
        {/* Main input row */}
        <div className="relative flex gap-1.5">
          <input
            ref={inputRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send() }
            }}
            maxLength={1000}
            placeholder={t("wc.chat.composer.placeholder")}
            data-testid="wc-drawer-chat-input"
            className="min-h-11 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-cyan-300/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || (!body.trim() && !selectedGif && !selectedImage)}
            data-testid="wc-drawer-chat-send"
            className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl bg-cyan-300 px-3 text-black disabled:cursor-not-allowed disabled:opacity-45"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        {/* Toolbar */}
        <div className="relative mt-1.5 flex flex-wrap gap-1">
          {/* Formatting */}
          {[
            { icon: Bold, label: "Bold", tag: "**" },
            { icon: Italic, label: "Italic", tag: "_" },
            { icon: Underline, label: "Underline", tag: "__" },
            { icon: Strikethrough, label: "Strike", tag: "~~" },
          ].map(({ icon: Icon, label, tag }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={() => setBody((prev) => `${prev}${tag}text${tag}`)}
              className="inline-flex h-8 w-8 touch-manipulation items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-white/50 hover:text-white/90"
            >
              <Icon className="h-3 w-3" aria-hidden />
            </button>
          ))}
          {/* Emoji picker trigger */}
          <div className="relative">
            <button
              type="button"
              aria-label={t("wc.chat.emoji.open")}
              onClick={() => setShowEmoji((v) => !v)}
              className="inline-flex h-8 touch-manipulation items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[10px] font-bold text-white/50 hover:text-white/90"
            >
              <Smile className="h-3 w-3" aria-hidden />
              {t("wc.chat.emoji.open")}
            </button>
            {showEmoji && (
              <EmojiPicker
                onInsert={(e) => setBody((prev) => `${prev}${e}`)}
                onClose={() => setShowEmoji(false)}
                t={t}
              />
            )}
          </div>
          {/* GIF */}
          <button
            type="button"
            aria-label="GIF"
            onClick={() => setPanel((p) => p === "gif" ? null : "gif")}
            className={[
              "inline-flex h-8 touch-manipulation items-center gap-1 rounded-lg border px-2 text-[10px] font-bold transition-colors",
              panel === "gif"
                ? "border-cyan-300/40 bg-cyan-300/10 text-white/90"
                : "border-white/10 bg-white/[0.05] text-white/50 hover:text-white/90",
            ].join(" ")}
          >
            <Film className="h-3 w-3" aria-hidden />
            GIF
          </button>
          {/* Image */}
          <button
            type="button"
            aria-label="Image"
            onClick={() => setPanel((p) => p === "image" ? null : "image")}
            className={[
              "inline-flex h-8 touch-manipulation items-center gap-1 rounded-lg border px-2 text-[10px] font-bold transition-colors",
              panel === "image"
                ? "border-cyan-300/40 bg-cyan-300/10 text-white/90"
                : "border-white/10 bg-white/[0.05] text-white/50 hover:text-white/90",
            ].join(" ")}
          >
            <ImageIcon className="h-3 w-3" aria-hidden />
            Image
          </button>
          {/* Poll */}
          <button
            type="button"
            aria-label="Poll"
            onClick={() => setPanel((p) => p === "poll" ? null : "poll")}
            className={[
              "inline-flex h-8 touch-manipulation items-center gap-1 rounded-lg border px-2 text-[10px] font-bold transition-colors",
              panel === "poll"
                ? "border-cyan-300/40 bg-cyan-300/10 text-white/90"
                : "border-white/10 bg-white/[0.05] text-white/50 hover:text-white/90",
            ].join(" ")}
          >
            <BarChart3 className="h-3 w-3" aria-hidden />
            Poll
          </button>
        </div>
        {/* Error */}
        {error && (
          <p className="mt-1.5 rounded-lg border border-rose-400/25 bg-rose-400/10 px-2.5 py-1.5 text-[11px] text-white/85">
            {error}
          </p>
        )}
        {/* Trust note */}
        <p className="mt-1 text-[9px] text-white/25">{t("wc.chat.trustNote")}</p>
      </div>
    </div>
  )
}

// ─── Chimmy AI Tab ────────────────────────────────────────────────────────────

function ChimmyTab({
  challengeId,
  aiUnlocked,
  t,
}: {
  challengeId: string
  aiUnlocked: boolean
  t: ReturnType<typeof makeWcT>
}) {
  const [prompt, setPrompt] = useState("")
  const [messages, setMessages] = useState<Array<{ role: "user" | "chimmy"; text: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const msgEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function ask() {
    const trimmed = prompt.trim()
    if (!trimmed) return
    const userMsg = trimmed
    setPrompt("")
    setMessages((prev) => [...prev, { role: "user", text: userMsg }])
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chimmy_private", body: userMsg }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setError(t("wc.chat.chimmy.rateLimit"))
        return
      }
      if (!res.ok) throw new Error(data.error || "Chimmy request failed")
      const reply = (data.chimmyResponse as WcChatMsg | undefined)?.body
        ?? (data.messages as WcChatMsg[] | undefined)?.find((m) => m.messageType === "chimmy_private_response")?.body
        ?? ""
      setMessages((prev) => [...prev, { role: "chimmy", text: reply || "…" }])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chimmy request failed")
    } finally {
      setLoading(false)
    }
  }

  if (!aiUnlocked) {
    return (
      <div
        data-testid="wc-drawer-chimmy-gate"
        className="flex h-full flex-col items-center justify-center gap-4 px-6 py-8 text-center"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 shadow-[0_0_24px_-6px_rgba(34,211,238,0.45)]">
          <Lock className="h-6 w-6 text-cyan-200/70" aria-hidden />
        </div>
        <div>
          <p className="font-black text-white">{t("wc.chat.chimmy.title")}</p>
          <p className="mt-1 text-xs leading-5 text-white/50">{t("wc.chat.chimmy.gate")}</p>
        </div>
        <Link
          href="/upgrade?plan=af_pro"
          className="inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-xl bg-cyan-300 px-5 py-2.5 text-sm font-black text-black"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {t("wc.chat.chimmy.gateUpgrade")}
        </Link>
        <p className="text-[9px] text-white/25">{t("wc.chat.chimmy.disclaimer")}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header hint */}
      <div className="border-b border-white/10 px-4 py-3">
        <p className="text-[11px] text-white/50">{t("wc.chat.chimmy.subtitle")}</p>
      </div>

      {/* Message thread */}
      <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3">
        {messages.length === 0 && !loading && (
          <div
            data-testid="wc-drawer-chimmy-empty"
            className="flex flex-col items-center gap-2 py-6 text-center text-white/40"
          >
            <Sparkles className="h-8 w-8 text-cyan-300/40" aria-hidden />
            <p className="text-xs">{t("wc.chat.chimmy.empty")}</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={[
              "rounded-xl border px-3 py-2 text-xs leading-5",
              msg.role === "user"
                ? "ml-6 border-cyan-300/20 bg-cyan-300/[0.06] text-white/80"
                : "mr-6 border-violet-300/20 bg-violet-400/[0.07] text-white/80",
            ].join(" ")}
          >
            {msg.role === "chimmy" && (
              <p className="mb-1 text-[10px] font-black text-violet-300/80">Chimmy</p>
            )}
            <p className="whitespace-pre-wrap break-words">{msg.text}</p>
          </div>
        ))}
        {loading && (
          <div className="mr-6 flex items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/[0.07] px-3 py-2.5 text-xs text-white/50">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("wc.chat.chimmy.sending")}
          </div>
        )}
        {error && (
          <p className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-[11px] text-white/85">
            {error}
          </p>
        )}
        <div ref={msgEndRef} />
      </div>

      {/* Prompt chips */}
      <div
        data-testid="wc-drawer-chimmy-chips"
        className="flex gap-1.5 overflow-x-auto overscroll-contain border-b border-white/[0.06] px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Suggestion chips"
      >
        {(
          [
            "wc.chat.chimmy.chip.liveNow",
            "wc.chat.chimmy.chip.playToday",
            "wc.chat.chimmy.chip.myBracket",
            "wc.chat.chimmy.chip.risky",
            "wc.chat.chimmy.chip.poolRank",
            "wc.chat.chimmy.chip.schedule",
          ] as const
        ).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPrompt(t(key))}
            disabled={loading}
            className="min-h-8 shrink-0 touch-manipulation rounded-full border border-violet-300/20 bg-violet-500/10 px-3 py-1 text-[11px] text-violet-200/80 transition-colors hover:bg-violet-500/20 disabled:opacity-40"
          >
            {t(key)}
          </button>
        ))}
      </div>

      {/* Composer */}
      <div className="border-t border-white/10 px-3 pb-[env(safe-area-inset-bottom,0px)] pt-2.5">
        <div className="flex gap-1.5">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask() }
            }}
            maxLength={1000}
            placeholder={t("wc.chat.chimmy.placeholder")}
            data-testid="wc-drawer-chimmy-input"
            disabled={loading}
            className="min-h-11 flex-1 rounded-xl border border-violet-300/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-violet-300/50 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void ask()}
            disabled={loading || !prompt.trim()}
            data-testid="wc-drawer-chimmy-send"
            className="inline-flex min-h-11 touch-manipulation items-center gap-1 rounded-xl bg-violet-500 px-3 text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Sparkles className="h-4 w-4" />
          </button>
        </div>
        <p
          data-testid="wc-drawer-chimmy-disclaimer"
          className="mt-1 text-[9px] text-white/25"
        >
          {t("wc.chat.chimmy.disclaimer")}
        </p>
      </div>
    </div>
  )
}

// ─── DMs Tab ─────────────────────────────────────────────────────────────────

function DmsTab({ t }: { t: ReturnType<typeof makeWcT> }) {
  return (
    <div
      data-testid="wc-drawer-dms-tab"
      className="flex h-full flex-col items-center justify-center gap-4 px-6 py-8 text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06]">
        <MessageSquare className="h-6 w-6 text-white/30" aria-hidden />
      </div>
      <div>
        <p className="font-black text-white">{t("wc.chat.dms.coming")}</p>
        <p className="mt-1.5 max-w-[220px] text-xs leading-5 text-white/45">
          {t("wc.chat.dms.hint")}
        </p>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WorldCupChatDrawer({
  challengeId,
  entitlementSummary,
  poolName,
}: {
  challengeId: string
  entitlementSummary: ReturnType<typeof resolveWorldCupEntitlementSummary>
  poolName: string
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])
  const [isOpen, setIsOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("chat")

  const aiUnlocked = entitlementSummary.ai

  const tabs: Array<{ id: DrawerTab; label: string; testId: string }> = [
    { id: "chat", label: t("wc.chat.drawer.tabChat"), testId: "wc-drawer-tab-chat" },
    { id: "chimmy", label: t("wc.chat.drawer.tabChimmy"), testId: "wc-drawer-tab-chimmy" },
    { id: "dms", label: t("wc.chat.drawer.tabDms"), testId: "wc-drawer-tab-dms" },
  ]

  return (
    <>
      {/* ── Floating bubble ── */}
      <button
        type="button"
        data-testid="wc-chat-drawer-bubble"
        aria-label={t("wc.chat.drawer.open")}
        onClick={() => setIsOpen(true)}
        className={[
          // Base: fixed bubble, bottom-left, clears mobile bottom nav
          "fixed left-4 z-50 inline-flex min-h-11 touch-manipulation items-center gap-1.5",
          "rounded-full border border-white/20 bg-zinc-900/95 px-3.5 py-2 text-xs font-black text-white",
          "shadow-[0_4px_24px_-6px_rgba(0,0,0,0.7),0_0_16px_-8px_rgba(34,211,238,0.45)] backdrop-blur-md",
          "transition-all hover:border-cyan-300/40 hover:bg-zinc-800 hover:shadow-[0_4px_24px_-6px_rgba(0,0,0,0.7),0_0_20px_-6px_rgba(34,211,238,0.65)] active:scale-95",
          // Clear bottom nav on mobile (56px nav + safe area + 8px gap)
          "bottom-[calc(56px+env(safe-area-inset-bottom,0px)+8px)]",
          // Desktop: lower position (no bottom nav)
          "sm:bottom-6",
          // Hide when drawer is already open
          isOpen ? "pointer-events-none opacity-0" : "opacity-100",
        ].join(" ")}
      >
        <span className="relative">
          <MessageSquare className="h-4 w-4 text-cyan-300/80" aria-hidden />
          {/* Pulsing activity dot — signals the chat is active */}
          <span
            aria-hidden
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-cyan-400 ring-2 ring-zinc-900/80 animate-pulse"
          />
        </span>
        <span>{t("wc.chat.drawer.open")}</span>
      </button>

      {/* ── Mobile backdrop ── */}
      {isOpen && (
        <div
          aria-hidden
          className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-[2px] sm:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* ── Drawer panel ── */}
      <div
        data-testid="wc-chat-drawer"
        role="dialog"
        aria-label={t("wc.chat.drawer.open")}
        aria-modal="true"
        className={[
          "fixed z-[90] flex flex-col overflow-hidden",
          "border border-white/15 bg-zinc-950 shadow-2xl",
          // Mobile: full-width bottom sheet
          "inset-x-0 bottom-0 h-[85dvh] rounded-t-2xl",
          // Desktop: anchored panel
          "sm:inset-x-auto sm:left-4 sm:bottom-6 sm:h-[600px] sm:w-[400px] sm:rounded-2xl",
          // Open/close animation
          "transition-transform duration-300 ease-out",
          isOpen ? "translate-y-0" : "translate-y-[calc(100%+8px)] sm:translate-y-[calc(100%+24px+8px)]",
        ].join(" ")}
      >
        {/* Atmospheric gradient overlay — decorative */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top_center,rgba(34,211,238,0.05),transparent_70%)] rounded-t-2xl" />

        {/* ── Drawer header ── */}
        <div className="relative flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <p className="truncate text-sm font-black text-white/90">{poolName}</p>
          <button
            type="button"
            aria-label={t("wc.chat.drawer.close")}
            onClick={() => setIsOpen(false)}
            data-testid="wc-chat-drawer-close"
            className="inline-flex min-h-9 min-w-9 touch-manipulation items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/50 transition-colors hover:border-white/20 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex shrink-0 border-b border-white/10">
          {tabs.map(({ id, label, testId }) => (
            <button
              key={id}
              type="button"
              data-testid={testId}
              aria-pressed={drawerTab === id}
              onClick={() => setDrawerTab(id)}
              className={[
                "flex-1 min-h-10 touch-manipulation border-b-2 py-2 text-xs font-black uppercase tracking-wide transition-colors",
                drawerTab === id
                  ? "border-cyan-300 text-white"
                  : "border-transparent text-white/40 hover:text-white/70",
              ].join(" ")}
            >
              {label}
              {id === "chimmy" && !aiUnlocked && (
                <Lock className="ml-1 inline h-2.5 w-2.5 text-white/30" aria-hidden />
              )}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="flex min-h-0 flex-1 flex-col">
          {drawerTab === "chat" && (
            <PoolChatTab challengeId={challengeId} language={language ?? "en"} t={t} />
          )}
          {drawerTab === "chimmy" && (
            <ChimmyTab challengeId={challengeId} aiUnlocked={aiUnlocked} t={t} />
          )}
          {drawerTab === "dms" && <DmsTab t={t} />}
        </div>
      </div>
    </>
  )
}

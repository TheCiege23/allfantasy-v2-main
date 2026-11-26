"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, LifeBuoy, MessageCircle, Send } from "lucide-react"

import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import {
  SUPPORT_MESSAGE_MAX,
  SUPPORT_STATUS_LABELS,
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_LABELS,
  type SupportStatus,
  type SupportTopic,
} from "@/lib/support/supportInboxCore"
import { DISCORD_SUPPORT_INVITE_URL } from "@/lib/support/discordSupportCore"

/**
 * /help — message AllFantasy, and read the replies (lib/support). One screen: the new-message form, your
 * conversations, and the one you opened. Replies also arrive as a notification and an email.
 */

type MessageView = { id: string; from: "member" | "staff"; event?: string; body: string; createdAt: string; authorName: string }
type ThreadView = { id: string; title: string; status: SupportStatus; lastMessageAt: string; messages?: MessageView[] }

/** The page they came from, when it was ours: context for whoever answers. */
function referrerPath(): string | undefined {
  try {
    const r = document.referrer ? new URL(document.referrer) : null
    return r && r.origin === window.location.origin ? r.pathname : undefined
  } catch {
    return undefined
  }
}

const COPY = {
  en: {
    title: "Get help",
    back: "Back",
    intro: "Tell us what's going on. A real person reads every message, and you'll get our reply here, in your notifications and by email.",
    topic: "What is this about?",
    message: "Your message",
    placeholder: "What happened, and what did you expect? The more detail, the faster we can help.",
    send: "Send",
    sending: "Sending…",
    sent: "Sent. We'll reply here as soon as we can.",
    yours: "Your conversations",
    none: "No conversations yet.",
    reply: "Reply",
    replyPlaceholder: "Write a reply…",
    closedNote: "This conversation is closed. Writing here reopens it.",
    loadFailed: "We couldn't load your conversations. Try again in a moment.",
    you: "You",
    signIn: "Sign in to message us",
    signInBody: "Sign in so our reply can reach you. Or email support@allfantasy.ai.",
    newMessage: "New message",
    tooLong: `Keep it under ${SUPPORT_MESSAGE_MAX.toLocaleString("en-US")} characters.`,
    discordTitle: "Prefer Discord?",
    discordBody: "Ask in #support on the AllFantasy Support server. We answer there, and you'll get a ping when we do. Keep account and billing questions here, since the channel is public.",
    discordCta: "Open #support on Discord",
  },
  es: {
    title: "Ayuda",
    back: "Volver",
    intro: "Cuéntanos qué pasa. Una persona lee cada mensaje, y recibirás nuestra respuesta aquí, en tus notificaciones y por correo.",
    topic: "¿De qué se trata?",
    message: "Tu mensaje",
    placeholder: "¿Qué pasó y qué esperabas? Cuantos más detalles, más rápido podemos ayudarte.",
    send: "Enviar",
    sending: "Enviando…",
    sent: "Enviado. Te responderemos aquí lo antes posible.",
    yours: "Tus conversaciones",
    none: "Todavía no tienes conversaciones.",
    reply: "Responder",
    replyPlaceholder: "Escribe una respuesta…",
    closedNote: "Esta conversación está cerrada. Si escribes aquí, se vuelve a abrir.",
    loadFailed: "No pudimos cargar tus conversaciones. Inténtalo de nuevo en un momento.",
    you: "Tú",
    signIn: "Inicia sesión para escribirnos",
    signInBody: "Inicia sesión para que nuestra respuesta te llegue. O escribe a support@allfantasy.ai.",
    newMessage: "Nuevo mensaje",
    tooLong: `Menos de ${SUPPORT_MESSAGE_MAX.toLocaleString("es-ES")} caracteres, por favor.`,
    discordTitle: "¿Prefieres Discord?",
    discordBody: "Pregunta en #support del servidor AllFantasy Support. Respondemos ahí y te llega una notificación. Las preguntas de cuenta y pagos, mejor aquí, porque el canal es público.",
    discordCta: "Abrir #support en Discord",
  },
} as const

export function HelpCenter({ signedIn, initialThreadId }: { signedIn: boolean; initialThreadId?: string | null }) {
  const { language } = useOptionalLanguage()
  const lang: "en" | "es" = language === "es" ? "es" : "en"
  const c = COPY[lang]

  const [threads, setThreads] = useState<ThreadView[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [openId, setOpenId] = useState<string | null>(initialThreadId ?? null)
  const [open, setOpen] = useState<ThreadView | null>(null)
  const [topic, setTopic] = useState<SupportTopic | "">("")
  const [text, setText] = useState("")
  const [reply, setReply] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/support/threads", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const json = (await res.json()) as { threads?: ThreadView[] }
      setThreads(json.threads ?? [])
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/support/threads/${encodeURIComponent(id)}`, { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const json = (await res.json()) as { thread?: ThreadView }
      setOpen(json.thread ?? null)
    } catch {
      setOpen(null)
    }
  }, [])

  useEffect(() => {
    if (signedIn) void loadList()
  }, [signedIn, loadList])
  useEffect(() => {
    if (signedIn && openId) void loadThread(openId)
    else setOpen(null)
  }, [signedIn, openId, loadThread])

  async function send() {
    setError(null)
    setNotice(null)
    if (!topic || !text.trim()) return
    if (text.length > SUPPORT_MESSAGE_MAX) return setError(c.tooLong)
    setBusy(true)
    try {
      const res = await fetch("/api/support/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, message: text, pagePath: referrerPath() }),
      })
      const json = (await res.json().catch(() => ({}))) as { threadId?: string; error?: string }
      if (!res.ok || !json.threadId) return setError(json.error ?? c.loadFailed)
      setText("")
      setTopic("")
      setNotice(c.sent)
      setOpenId(json.threadId)
      await loadList()
    } finally {
      setBusy(false)
    }
  }

  async function sendReply() {
    if (!open || !reply.trim()) return
    setError(null)
    if (reply.length > SUPPORT_MESSAGE_MAX) return setError(c.tooLong)
    setBusy(true)
    try {
      const res = await fetch(`/api/support/threads/${encodeURIComponent(open.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) return setError(json.error ?? c.loadFailed)
      setReply("")
      await Promise.all([loadThread(open.id), loadList()])
    } finally {
      setBusy(false)
    }
  }

  const panel = { borderColor: "var(--border)", background: "var(--panel)" } as const

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6" data-testid="help-center">
      <header className="mb-4 flex items-center gap-3">
        <Link
          href="/core"
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {c.back}
        </Link>
        <h1 className="flex items-center gap-2 text-lg font-semibold" style={{ color: "var(--text)" }}>
          <LifeBuoy className="h-5 w-5" style={{ color: "var(--accent)" }} aria-hidden />
          {c.title}
        </h1>
      </header>

      <section className="mb-4 rounded-2xl border p-4" style={panel} data-testid="help-discord">
        <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
          <MessageCircle className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden />
          {c.discordTitle}
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{c.discordBody}</p>
        <a
          href={DISCORD_SUPPORT_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-[40px] items-center rounded-xl border px-3 py-2 text-sm font-semibold"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
          data-testid="help-discord-link"
        >
          {c.discordCta}
        </a>
      </section>

      {!signedIn ? (
        <section className="rounded-2xl border p-4" style={panel} data-testid="help-signed-out">
          <p className="font-semibold" style={{ color: "var(--text)" }}>{c.signIn}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{c.signInBody}</p>
          <Link
            href={`/login?callbackUrl=${encodeURIComponent("/help")}`}
            className="mt-3 inline-block rounded-xl px-3 py-2 text-sm font-semibold"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            {c.signIn}
          </Link>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border p-4" style={panel} data-testid="help-new-message">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{c.newMessage}</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{c.intro}</p>
            <label className="mt-3 block text-xs font-medium" style={{ color: "var(--muted)" }} htmlFor="help-topic">{c.topic}</label>
            <select
              id="help-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value as SupportTopic)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
            >
              <option value="" disabled>—</option>
              {SUPPORT_TOPICS.map((t) => (
                <option key={t} value={t}>{SUPPORT_TOPIC_LABELS[lang][t]}</option>
              ))}
            </select>
            <label className="mt-3 block text-xs font-medium" style={{ color: "var(--muted)" }} htmlFor="help-message">{c.message}</label>
            <textarea
              id="help-message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={SUPPORT_MESSAGE_MAX}
              placeholder={c.placeholder}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || !topic || !text.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--accent)", color: "var(--bg)" }}
                data-testid="help-send"
              >
                <Send className="h-4 w-4" aria-hidden />
                {busy ? c.sending : c.send}
              </button>
              {notice ? <span className="text-sm" style={{ color: "var(--accent)" }} role="status">{notice}</span> : null}
            </div>
            {error ? <p className="mt-2 text-sm text-red-400" role="alert">{error}</p> : null}
          </section>

          <section className="mt-4 rounded-2xl border p-4" style={panel} data-testid="help-threads">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{c.yours}</h2>
            {loadError ? (
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{c.loadFailed}</p>
            ) : threads && threads.length === 0 ? (
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{c.none}</p>
            ) : (
              <ul className="mt-2 divide-y" style={{ borderColor: "var(--border)" }}>
                {(threads ?? []).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(t.id)}
                      className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm"
                      style={{ color: "var(--text)", fontWeight: t.id === openId ? 600 : 400 }}
                    >
                      <span className="min-w-0 truncate">{t.title}</span>
                      <span className="shrink-0 text-xs" style={{ color: t.status === "answered" ? "var(--accent)" : "var(--muted)" }}>
                        {SUPPORT_STATUS_LABELS[lang][t.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {open ? (
            <section className="mt-4 rounded-2xl border p-4" style={panel} data-testid="help-thread">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{open.title}</h2>
              <ol className="mt-3 space-y-3">
                {(open.messages ?? []).map((m) =>
                  m.event && m.event !== "opened" ? (
                    <li key={m.id} className="text-center text-xs" style={{ color: "var(--muted)" }}>{m.body}</li>
                  ) : (
                    <li key={m.id} className={m.from === "staff" ? "mr-8" : "ml-8"}>
                      <div className="text-xs font-semibold" style={{ color: m.from === "staff" ? "var(--accent)" : "var(--muted)" }}>
                        {m.from === "staff" ? m.authorName : c.you}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                        {m.body}
                      </div>
                    </li>
                  ),
                )}
              </ol>
              {open.status === "closed" ? <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>{c.closedNote}</p> : null}
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                maxLength={SUPPORT_MESSAGE_MAX}
                placeholder={c.replyPlaceholder}
                aria-label={c.reply}
                className="mt-3 w-full rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
              />
              <button
                type="button"
                onClick={() => void sendReply()}
                disabled={busy || !reply.trim()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--accent)", color: "var(--bg)" }}
                data-testid="help-reply"
              >
                <Send className="h-4 w-4" aria-hidden />
                {c.reply}
              </button>
            </section>
          ) : null}
        </>
      )}
    </main>
  )
}

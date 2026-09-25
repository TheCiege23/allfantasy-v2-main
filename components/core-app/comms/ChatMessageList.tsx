'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ArrowDown, Copy, CornerUpLeft, MoreHorizontal, Pencil, Pin, SmilePlus, Trash2 } from 'lucide-react'
import { QUICK_REACTIONS, type ViewerReaction } from '@/lib/chat-core/messageReactions'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { isNearBottom } from '@/lib/chat-core/useChatPolling'
import {
  formatChatMessageTimestamp,
  formatChatMessageTimestampFull,
  toDateTimeAttr,
} from '@/lib/chat-core/chat-timestamps'
import { EmojiPicker } from '@/app/dashboard/components/chat/EmojiPicker'
import { useOverlayContainment } from '../useOverlayContainment'
import { QuotedMessage } from './QuotedMessage'
import { renderMessageText } from './messageText'
import { MessageReactions } from './MessageReactions'
import { hasRichContent } from './RichMessage'
import {
  describeReactors,
  initialsFor,
  isDeletedMessage,
  isEditedMessage,
  layoutMessages,
  reactorIds,
  safeAvatarUrl,
  visibleBody,
} from './chatLayout'

/**
 * League, DM and Huddle messages, laid out as a conversation.
 *
 * ⚠ ONE LIST FOR ALL THREE TABS. They were three near-copies of a flat row —
 * bold name, grey time, text — and the league one had drifted (pin) from the
 * other two (receipts). What differs between them is passed in: which actions
 * exist (pin is league-only), where reactions go, and how rich content renders.
 *
 * What a reader gets, and why each is here:
 *   - YOUR SIDE / THEIR SIDE. Yours on the right in the accent colour; theirs on
 *     the left with the sender's avatar (initials when there is none).
 *   - RUNS. Name and avatar once per run of messages from one sender inside five
 *     minutes, the time once under the run — see `chatLayout.ts`. Tap a bubble
 *     for its own time; hover shows the full stamp.
 *   - DAY SEPARATORS, so three days of trade talk is not one undated wall.
 *   - ACTIONS on every message: long-press on touch, a hover bar on desktop,
 *     Enter / Shift+F10 / the context-menu key from the keyboard. React (quick
 *     six or the full picker), reply (with a jump back to the original), copy the
 *     text (anybody's, including your own), pin (league), edit / delete your own.
 *   - WHO REACTED, by name, from people already on screen.
 *   - JUMP TO LATEST when you have scrolled up and something new arrives, with a
 *     count — the place you were reading is never yanked away from you.
 */

export type ChatListMessage = {
  id: string
  authorId: string | null
  authorName: string
  avatarUrl?: string | null
  body: string
  createdAt: string
  parentMessageId?: string | null
  metadata?: Record<string, unknown> | null
  messageType?: string | null
}

export type ChatMessageListProps = {
  messages: ChatListMessage[]
  viewerId: string | null
  /** Accessible name of the conversation, e.g. "Messages in Dynasty Degenerates". */
  label: string
  /** The viewer's reactions for a message, including any in-flight override. */
  reactionsFor: (m: ChatListMessage) => ViewerReaction[]
  reactionBusyId?: string | null
  onToggleReaction: (m: ChatListMessage, emoji: string) => void
  onReply: (m: ChatListMessage) => void
  /** League only. Absent means the action is not offered. */
  onPin?: (m: ChatListMessage) => void
  pinBusy?: boolean
  /** Your own messages. Reject to keep the editor open with the text intact. */
  onEdit?: (m: ChatListMessage, nextBody: string) => Promise<void>
  onDelete?: (m: ChatListMessage) => Promise<void>
  /** GIF, images, poll, trade card. Rendered inside the bubble. */
  renderRich: (m: ChatListMessage) => ReactNode
  /** A display name for a user id, from people the panel already knows. */
  nameForUserId: (userId: string) => string | null
  /** Shown instead of the list when there are no messages. */
  empty?: ReactNode
  /** Rendered after the last message, inside the scroller (notes, errors). */
  footer?: ReactNode
  /** A message to scroll to and flash — a search hit, a pinned item. Bump `nonce` to repeat. */
  focusRequest?: { id: string; nonce: number } | null
  /**
   * A row that is not somebody talking — a draft pick, a note from the draft copilot that only
   * you can see. Return the card to draw it across the conversation, with no bubble and no
   * actions (there is nothing to reply to or react to); return null for an ordinary message.
   */
  renderSystem?: (m: ChatListMessage) => ReactNode | null
  /** A short label over the bubble, e.g. "Draft room" on a message posted from the draft. */
  tagFor?: (m: ChatListMessage) => string | null
  /**
   * Whether `renderRich` draws anything for this message. Defaults to `hasRichContent`; a
   * surface that renders shapes RichMessage does not know (the draft room's older polls)
   * says so here, or its renderer is never asked.
   */
  hasRichFor?: (m: ChatListMessage) => boolean
  /** A test id on the scrolling element itself (the draft room's specs find it by one). */
  scrollTestId?: string
}

const LONG_PRESS_MS = 450
const MOVE_CANCEL_PX = 10

function MessageAvatar({ name, url }: { name: string; url: string | null | undefined }) {
  const safe = safeAvatarUrl(url)
  const [failed, setFailed] = useState(false)
  return (
    <span className="af-cm-avatar" aria-hidden="true">
      {safe && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={safe} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="af-cm-avatar-initials">{initialsFor(name)}</span>
      )}
    </span>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* Fall through to the legacy path — some webviews refuse the async API. */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/** What "Copy" puts on the clipboard: the words, or the link when there are none. */
export function copyableText(m: ChatListMessage, mine: boolean, rich: boolean): string | null {
  const shown = visibleBody({ body: m.body, metadata: m.metadata, messageType: m.messageType, hasRich: rich })
  if (shown) return mine ? shown : censorProfanity(shown)
  if (m.messageType === 'gif' && /^https:\/\//.test(m.body.trim())) return m.body.trim()
  const meta = m.metadata
  const gif = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).gif : null
  if (gif && typeof gif === 'object' && typeof (gif as Record<string, unknown>).url === 'string') {
    return String((gif as Record<string, unknown>).url)
  }
  return null
}

export function ChatMessageList({
  messages,
  viewerId,
  label,
  reactionsFor,
  reactionBusyId = null,
  onToggleReaction,
  onReply,
  onPin,
  pinBusy = false,
  onEdit,
  onDelete,
  renderRich,
  nameForUserId,
  empty,
  footer,
  focusRequest = null,
  renderSystem,
  tagFor,
  hasRichFor,
  scrollTestId,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [timeFor, setTimeFor] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string; busy: boolean; error: string | null } | null>(
    null,
  )
  const [toast, setToast] = useState<string | null>(null)
  const [unseen, setUnseen] = useState(0)
  const [awayFromBottom, setAwayFromBottom] = useState(false)

  const byId = useMemo(() => {
    const map = new Map<string, ChatListMessage>()
    for (const m of messages) map.set(m.id, m)
    return map
  }, [messages])

  const items = useMemo(() => layoutMessages(messages, viewerId), [messages, viewerId])

  const richOf = useCallback(
    (m: ChatListMessage) => (hasRichFor ? hasRichFor(m) : hasRichContent(m.metadata, m.messageType, m.body)),
    [hasRichFor],
  )

  /* ── Scrolling: follow the conversation only when the reader is already at the end ── */
  const wasNearBottom = useRef(true)
  const lastSeenId = useRef<string | null>(null)

  const scrollToEnd = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    else el.scrollTop = el.scrollHeight
    wasNearBottom.current = true
    setUnseen(0)
    setAwayFromBottom(false)
  }, [])

  useLayoutEffect(() => {
    const last = messages[messages.length - 1]
    const lastId = last?.id ?? null
    const previous = lastSeenId.current
    lastSeenId.current = lastId
    if (!lastId || lastId === previous) return
    const mineJustNow = Boolean(viewerId) && last?.authorId === viewerId
    if (previous === null || wasNearBottom.current || mineJustNow) {
      scrollToEnd(false)
      return
    }
    /* Somebody spoke while you were reading back: count it, do not move you. */
    const prevIndex = messages.findIndex((m) => m.id === previous)
    const added = prevIndex >= 0 ? messages.length - 1 - prevIndex : 1
    setUnseen((n) => n + Math.max(1, added))
  }, [messages, viewerId, scrollToEnd])

  const onScroll = useCallback(() => {
    const near = isNearBottom(scrollRef.current)
    wasNearBottom.current = near
    setAwayFromBottom(!near)
    if (near) setUnseen(0)
  }, [])

  /* ── Jumping to a message (reply quote, search hit, pin) ── */
  const jumpTo = useCallback((id: string): boolean => {
    const el = document.getElementById(`af-cm-msg-${id}`)
    if (!el || !scrollRef.current?.contains(el)) return false
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    setFlashId(id)
    window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1600)
    return true
  }, [])

  const focusNonce = focusRequest?.nonce ?? 0
  useEffect(() => {
    if (focusRequest) jumpTo(focusRequest.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  /* ── Feedback ── */
  const toastTimer = useRef<number | null>(null)
  const say = useCallback((text: string) => {
    setToast(text)
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1600)
  }, [])
  useEffect(() => () => {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current)
  }, [])

  /* ── Long-press ── */
  const press = useRef<{ id: string; x: number; y: number; timer: number } | null>(null)
  const swallowClickFor = useRef<string | null>(null)
  const cancelPress = useCallback(() => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }, [])

  const openMenu = useCallback(
    (id: string) => {
      cancelPress()
      setMenuFor(id)
    },
    [cancelPress],
  )

  const menuMessage = menuFor ? byId.get(menuFor) ?? null : null

  if (messages.length === 0) {
    return (
      <div className="af-cm-chatwrap">
        <div className="af-cm-thread af-cm-chat" ref={scrollRef} role="log" aria-label={label} data-testid={scrollTestId}>
          {empty}
          {footer}
        </div>
      </div>
    )
  }

  return (
    <div className="af-cm-chatwrap">
      <div
        className="af-cm-thread af-cm-chat"
        ref={scrollRef}
        data-testid={scrollTestId}
        role="log"
        aria-label={label}
        aria-live="polite"
        aria-relevant="additions"
        onScroll={onScroll}
      >
        {items.map((item) => {
          if (item.kind === 'day') {
            return (
              <div key={item.key} className="af-cm-day" role="separator" aria-label={item.label}>
                <span>{item.label}</span>
              </div>
            )
          }
          const m = item.message
          const system = renderSystem ? renderSystem(m) : null
          if (system != null) {
            return (
              <div
                key={m.id}
                id={`af-cm-msg-${m.id}`}
                data-message-id={m.id}
                className="af-cm-row af-cm-row-system"
                data-system="true"
                data-flash={flashId === m.id || undefined}
              >
                {system}
              </div>
            )
          }
          const mine = item.mine
          const deleted = isDeletedMessage(m.metadata)
          const rich = !deleted && richOf(m)
          const tag = tagFor ? tagFor(m) : null
          const shown = deleted
            ? null
            : visibleBody({ body: m.body, metadata: m.metadata, messageType: m.messageType, hasRich: rich })
          const parent = m.parentMessageId ? byId.get(m.parentMessageId) : undefined
          const reactions = deleted ? [] : reactionsFor(m)
          const ids = deleted ? {} : reactorIds(m.metadata)
          const isEditing = editing?.id === m.id
          const showTime = item.endsRun || timeFor === m.id
          const time = formatChatMessageTimestamp(m.createdAt)

          return (
            <div
              key={m.id}
              id={`af-cm-msg-${m.id}`}
              data-message-id={m.id}
              className="af-cm-row"
              data-mine={mine}
              data-run-start={item.startsRun}
              data-run-end={item.endsRun}
              data-flash={flashId === m.id || undefined}
              data-menu={menuFor === m.id || undefined}
            >
              {!mine ? (
                item.startsRun ? (
                  <MessageAvatar name={m.authorName} url={m.avatarUrl} />
                ) : (
                  <span className="af-cm-avatar-gap" aria-hidden="true" />
                )
              ) : null}

              <div className="af-cm-col">
                {!mine && item.startsRun ? <span className="af-cm-msg-author">{m.authorName}</span> : null}
                {tag ? <span className="af-cm-msg-tag">{tag}</span> : null}

                {m.parentMessageId && !deleted ? (
                  <QuotedMessage
                    author={parent?.authorName ?? null}
                    text={parent ? censorProfanity(parent.body) : null}
                    onJump={parent ? () => void jumpTo(parent.id) : undefined}
                  />
                ) : null}

                <div
                  className="af-cm-bubble"
                  data-deleted={deleted || undefined}
                  tabIndex={0}
                  role="article"
                  aria-label={`${mine ? 'You' : m.authorName}${time ? `, ${time}` : ''}${deleted ? ', deleted' : ''}. Press Enter for actions.`}
                  title={formatChatMessageTimestampFull(m.createdAt) || undefined}
                  onClick={(e) => {
                    if (swallowClickFor.current === m.id) {
                      swallowClickFor.current = null
                      return
                    }
                    if (isEditing) return
                    /* A tap on the poll, the photo or a link is that control's, not "show the time". */
                    if ((e.target as HTMLElement).closest?.('button, a, input, textarea, video, audio, label')) return
                    setTimeFor((cur) => (cur === m.id ? null : m.id))
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                      e.preventDefault()
                      if (!deleted) openMenu(m.id)
                    }
                  }}
                  onContextMenu={(e) => {
                    if (deleted || isEditing) return
                    /* A right-click on desktop, and Android's own long-press, open the same menu. */
                    e.preventDefault()
                    openMenu(m.id)
                  }}
                  onPointerDown={(e) => {
                    if (deleted || isEditing || e.pointerType === 'mouse') return
                    cancelPress()
                    const id = m.id
                    press.current = {
                      id,
                      x: e.clientX,
                      y: e.clientY,
                      timer: window.setTimeout(() => {
                        swallowClickFor.current = id
                        press.current = null
                        try {
                          navigator.vibrate?.(8)
                        } catch {
                          /* optional */
                        }
                        setMenuFor(id)
                      }, LONG_PRESS_MS),
                    }
                  }}
                  onPointerMove={(e) => {
                    const p = press.current
                    if (!p) return
                    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_CANCEL_PX) cancelPress()
                  }}
                  onPointerUp={cancelPress}
                  onPointerCancel={cancelPress}
                >
                  {deleted ? (
                    <p className="af-cm-bubble-text af-cm-bubble-deleted">Message deleted</p>
                  ) : isEditing && editing ? (
                    <form
                      className="af-cm-edit"
                      onClick={(e) => e.stopPropagation()}
                      onSubmit={(e) => {
                        e.preventDefault()
                        const next = editing.text.trim()
                        if (!next || !onEdit) return
                        if (next === m.body.trim()) {
                          setEditing(null)
                          return
                        }
                        setEditing({ ...editing, busy: true, error: null })
                        onEdit(m, next)
                          .then(() => setEditing(null))
                          .catch((err: unknown) =>
                            setEditing((cur) =>
                              cur && cur.id === m.id
                                ? {
                                    ...cur,
                                    busy: false,
                                    error: err instanceof Error ? err.message : 'Could not save that edit.',
                                  }
                                : cur,
                            ),
                          )
                      }}
                    >
                      <textarea
                        className="af-cm-edit-input"
                        value={editing.text}
                        autoFocus
                        maxLength={2000}
                        aria-label="Edit your message"
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            e.stopPropagation()
                            setEditing(null)
                          }
                        }}
                      />
                      {editing.error ? <p className="af-cm-edit-error">{editing.error}</p> : null}
                      <span className="af-cm-edit-actions">
                        <button type="button" className="af-cm-edit-btn" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="af-cm-edit-btn"
                          data-primary="true"
                          disabled={editing.busy || !editing.text.trim()}
                        >
                          {editing.busy ? 'Saving…' : 'Save'}
                        </button>
                      </span>
                    </form>
                  ) : (
                    <>
                      {/*
                        Links and "@sam" highlights as React nodes (messageText.tsx) — the one place
                        a bubble's words are drawn, for league chat, DMs and huddles alike.
                      */}
                      {shown ? <p className="af-cm-bubble-text">{renderMessageText(censorProfanity(shown))}</p> : null}
                      {rich ? renderRich(m) : null}
                    </>
                  )}
                </div>

                {!deleted ? (
                  <MessageReactions
                    reactions={reactions}
                    showAdd={false}
                    disabled={reactionBusyId === m.id}
                    onToggle={(emoji) => onToggleReaction(m, emoji)}
                    describe={(emoji) => describeReactors(ids[emoji] ?? [], viewerId, nameForUserId).text}
                    onShowWho={() => openMenu(m.id)}
                  />
                ) : null}

                {showTime && time ? (
                  <span className="af-cm-meta">
                    <time dateTime={toDateTimeAttr(m.createdAt)} title={formatChatMessageTimestampFull(m.createdAt)}>
                      {time}
                    </time>
                    {isEditedMessage(m.metadata) && !deleted ? <span className="af-cm-edited"> · edited</span> : null}
                  </span>
                ) : null}
              </div>

              {/*
                Desktop's quick path: three reactions, reply, and everything else.
                Mouse-only duplicates of the menu (tabIndex -1) — keyboard users get
                one stop per message and the full menu from Enter.
              */}
              {!deleted && !isEditing ? (
                <div className="af-cm-hoverbar" aria-hidden="true">
                  {QUICK_REACTIONS.slice(0, 3).map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      tabIndex={-1}
                      className="af-cm-hoverbtn"
                      disabled={reactionBusyId === m.id}
                      onClick={() => onToggleReaction(m, emoji)}
                      title={`React ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    type="button"
                    tabIndex={-1}
                    className="af-cm-hoverbtn"
                    onClick={() => onReply(m)}
                    title="Reply"
                  >
                    <CornerUpLeft size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="af-cm-hoverbtn"
                    onClick={() => openMenu(m.id)}
                    title="More — react, copy, pin"
                  >
                    <MoreHorizontal size={14} aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
        {footer}
      </div>

      {awayFromBottom || unseen > 0 ? (
        <button
          type="button"
          className="af-cm-jump"
          data-new={unseen > 0 || undefined}
          onClick={() => scrollToEnd(true)}
          aria-label={unseen > 0 ? `Jump to latest, ${unseen} new` : 'Jump to latest'}
        >
          <ArrowDown size={14} aria-hidden />
          <span>{unseen > 0 ? `${unseen} new` : 'Latest'}</span>
        </button>
      ) : null}

      {toast ? (
        <p className="af-cm-toast" role="status">
          {toast}
        </p>
      ) : null}

      {menuMessage ? (
        <MessageActionSheet
          message={menuMessage}
          mine={Boolean(viewerId) && menuMessage.authorId === viewerId}
          viewerId={viewerId}
          reactions={reactionsFor(menuMessage)}
          reactorIdsByEmoji={reactorIds(menuMessage.metadata)}
          nameForUserId={nameForUserId}
          busy={reactionBusyId === menuMessage.id}
          onClose={() => setMenuFor(null)}
          onReact={(emoji) => {
            onToggleReaction(menuMessage, emoji)
            setMenuFor(null)
          }}
          onReply={() => {
            onReply(menuMessage)
            setMenuFor(null)
          }}
          onCopy={async () => {
            const mine = Boolean(viewerId) && menuMessage.authorId === viewerId
            const rich = richOf(menuMessage)
            const text = copyableText(menuMessage, mine, rich)
            setMenuFor(null)
            if (!text) {
              say('Nothing to copy')
              return
            }
            say((await copyText(text)) ? 'Copied' : 'Could not copy — select the text instead')
          }}
          onPin={
            onPin
              ? () => {
                  onPin(menuMessage)
                  setMenuFor(null)
                }
              : undefined
          }
          pinBusy={pinBusy}
          onEdit={
            onEdit && viewerId && menuMessage.authorId === viewerId && menuMessage.messageType !== 'gif'
              ? () => {
                  setEditing({ id: menuMessage.id, text: menuMessage.body, busy: false, error: null })
                  setMenuFor(null)
                }
              : undefined
          }
          onDelete={
            onDelete && viewerId && menuMessage.authorId === viewerId
              ? async () => {
                  const target = menuMessage
                  setMenuFor(null)
                  try {
                    await onDelete(target)
                    say('Deleted')
                  } catch (err) {
                    say(err instanceof Error ? err.message : 'Could not delete that')
                  }
                }
              : undefined
          }
        />
      ) : null}
    </div>
  )
}

function MessageActionSheet({
  message,
  mine,
  viewerId,
  reactions,
  reactorIdsByEmoji,
  nameForUserId,
  busy,
  onClose,
  onReact,
  onReply,
  onCopy,
  onPin,
  pinBusy,
  onEdit,
  onDelete,
}: {
  message: ChatListMessage
  mine: boolean
  viewerId: string | null
  reactions: ViewerReaction[]
  reactorIdsByEmoji: Record<string, string[]>
  nameForUserId: (id: string) => string | null
  busy: boolean
  onClose: () => void
  onReact: (emoji: string) => void
  onReply: () => void
  onCopy: () => void
  onPin?: () => void
  pinBusy: boolean
  onEdit?: () => void
  onDelete?: () => void
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const firstRef = useRef<HTMLButtonElement | null>(null)
  const [fullPicker, setFullPicker] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useOverlayContainment({ active: true, containerRef: sheetRef, initialFocusRef: firstRef, onClose })

  const preview = censorProfanity(message.body || '').slice(0, 120)
  const who = reactions
    .map((r) => ({ emoji: r.emoji, text: describeReactors(reactorIdsByEmoji[r.emoji] ?? [], viewerId, nameForUserId).text }))
    .filter((r) => r.text)

  return (
    <div className="af-cm-sheet-scrim" onClick={onClose}>
      <div
        ref={sheetRef}
        className="af-cm-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Actions for ${mine ? 'your message' : `${message.authorName}'s message`}`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="af-cm-sheet-preview">
          <b>{mine ? 'You' : message.authorName}</b>
          <span>{preview || 'Photo, GIF or poll'}</span>
        </p>

        <div className="af-cm-sheet-react" role="group" aria-label="React">
          {QUICK_REACTIONS.map((emoji, i) => {
            const on = reactions.some((r) => r.emoji === emoji && r.mine)
            return (
              <button
                key={emoji}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                className="af-cm-sheet-emoji"
                data-on={on || undefined}
                aria-pressed={on}
                aria-label={on ? `Remove your ${emoji}` : `React ${emoji}`}
                disabled={busy}
                onClick={() => onReact(emoji)}
              >
                {emoji}
              </button>
            )
          })}
          <button
            type="button"
            className="af-cm-sheet-emoji"
            aria-label="More emoji"
            aria-expanded={fullPicker}
            onClick={() => setFullPicker((v) => !v)}
          >
            <SmilePlus size={18} aria-hidden />
          </button>
        </div>

        {fullPicker ? (
          <div className="af-chat-picker af-cm-sheet-picker">
            <EmojiPicker onSelect={(c) => onReact(c)} onClose={() => setFullPicker(false)} />
          </div>
        ) : null}

        {who.length > 0 ? (
          <div className="af-cm-sheet-who">
            <p className="af-cm-sheet-label">Reactions</p>
            <ul>
              {who.map((r) => (
                <li key={r.emoji}>
                  <span aria-hidden="true">{r.emoji}</span> {r.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="af-cm-sheet-actions">
          <button type="button" className="af-cm-sheet-btn" onClick={onReply}>
            <CornerUpLeft size={16} aria-hidden /> Reply
          </button>
          <button type="button" className="af-cm-sheet-btn" onClick={onCopy}>
            <Copy size={16} aria-hidden /> {mine ? 'Copy your message' : 'Copy text'}
          </button>
          {onPin ? (
            <button type="button" className="af-cm-sheet-btn" onClick={onPin} disabled={pinBusy}>
              <Pin size={16} aria-hidden /> Pin for the league
            </button>
          ) : null}
          {onEdit ? (
            <button type="button" className="af-cm-sheet-btn" onClick={onEdit}>
              <Pencil size={16} aria-hidden /> Edit
            </button>
          ) : null}
          {onDelete ? (
            confirmDelete ? (
              <span className="af-cm-sheet-confirm">
                <span>Delete for everyone?</span>
                <button type="button" className="af-cm-sheet-btn" data-danger="true" onClick={onDelete}>
                  Delete
                </button>
                <button type="button" className="af-cm-sheet-btn" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="af-cm-sheet-btn" data-danger="true" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} aria-hidden /> Delete
              </button>
            )
          ) : null}
        </div>

        <button type="button" className="af-cm-sheet-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export default ChatMessageList

'use client'

import { Send } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AttachmentPreview, type PendingGif, type PollDraft, type UploadedAttachment } from './AttachmentPreview'
import { EmojiPicker } from './EmojiPicker'
import { GifPicker } from './GifPicker'
import { PollComposer } from './PollComposer'
import { VoiceRecorder } from './VoiceRecorder'
import { MentionAutocomplete } from './MentionAutocomplete'
import { GlobalBroadcastModal } from './GlobalBroadcastModal'
import { useMentionAutocomplete, type MentionSuggestion } from '@/lib/chat-core/useMentionAutocomplete'

export type LeagueComposerPayload = {
  text: string
  gifId?: string
  giphyId?: string
  gifUrl?: string
  previewUrl?: string
  gifTitle?: string
  attachments?: Array<{
    type: 'image' | 'video' | 'voice'
    url: string
    duration?: number
    mimeType?: string
  }>
  poll?: { question: string; options: string[]; closeAt: Date; allowMultiple: boolean; anonymous?: boolean }
}

type ChatComposerProps = {
  leagueId: string
  onSend: (message: LeagueComposerPayload) => void | Promise<void>
  placeholder?: string
  /** Renders "Ask Chimmy" in the composer toolbar (e.g. league chat left panel). */
  onAskChimmy?: () => void
  /** One-shot prefill from deep link query `?zombieChimmy=` (e.g. Zombie inventory → league chat). */
  initialDraftText?: string | null
  /** When set, fetches Big Brother @Chimmy autocomplete for this league. */
  bigBrotherAutocompleteLeagueId?: string | null
  /** When set, fetches C2C @Chimmy autocomplete for this league. */
  c2cAutocompleteLeagueId?: string | null
  /** When set, fetches IDP @Chimmy autocomplete for this league (mutually exclusive with BB in practice). */
  idpAutocompleteLeagueId?: string | null
  chatType?: 'league' | 'huddle' | 'dm' | 'chimmy' | 'draft'
  /**
   * The platform chat thread this composer posts into, for DMs and huddles.
   * Uploads are authorised against EITHER a league or a thread — a DM has no
   * league, and without this the upload endpoint answered "leagueId required",
   * which is a message about a concept these chats do not have.
   */
  threadId?: string | null
  isCommissioner?: boolean
  commissionerLeagues?: { id: string; name: string; teamCount: number }[]
  currentUserId?: string
  /**
   * The writer's own leagues, offered by the `#` autocomplete alongside player
   * names. Matched on the client — the list is already here, and a round trip to
   * filter a dozen names the browser is holding would be silly.
   */
  autocompleteLeagues?: { id: string; name: string }[]
  /** Narrows the player catalog when the surface knows which sport it is about. */
  sport?: string | null
  /**
   * The conversation this composer belongs to. Photos dropped anywhere on it are
   * added to the message, exactly as if picked with the 📷 button. While a file is
   * dragged over it, it carries `data-af-drop="active"` for the drop hint.
   */
  dropZoneRef?: React.RefObject<HTMLElement | null>
  /**
   * Called with `true` as the writer types and `false` once the box is empty or
   * the message has gone. The caller throttles the network signal — see
   * `useTypingSignal` — so this can fire on every keystroke.
   */
  onTypingChange?: (typing: boolean) => void
  /**
   * People to offer after `@`, matched here on the client. A DM or huddle has no
   * league, so the league member search has nothing to ask — without this, `@`
   * offered only the static entries and never a single person in the thread.
   */
  mentionMembers?: Array<{ username: string; displayName?: string | null; avatarUrl?: string | null }>
}

/*
 * The upload route's own limits (`app/api/chat/upload/route.ts`), checked here
 * first so a wrong file is refused with a reason BEFORE a 25 MB round trip.
 */
const IMAGE_MIME = /^image\/(png|jpeg|gif|webp)$/
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
/** Photos per message. A drop of a whole camera roll should not become 40 uploads. */
const MAX_IMAGES_PER_MESSAGE = 4

export function imageRejection(file: { type: string; size: number }): string | null {
  if (!IMAGE_MIME.test(file.type)) return 'Photos must be JPG, PNG, GIF or WebP.'
  if (file.size > MAX_IMAGE_BYTES) return 'That photo is over 25 MB — try a smaller one.'
  return null
}

type Picker = 'gif' | 'emoji' | 'poll' | null

export function ChatComposer({
  leagueId,
  onSend,
  placeholder = 'Message league...',
  onAskChimmy,
  initialDraftText = null,
  bigBrotherAutocompleteLeagueId = null,
  c2cAutocompleteLeagueId = null,
  idpAutocompleteLeagueId = null,
  chatType = 'league',
  threadId = null,
  isCommissioner = false,
  commissionerLeagues = [],
  currentUserId,
  autocompleteLeagues,
  sport,
  dropZoneRef,
  onTypingChange,
  mentionMembers,
}: ChatComposerProps) {
  const [text, setText] = useState('')
  /** Photos on their way up. Shown as chips so a slow upload never looks like nothing happened. */
  const [uploading, setUploading] = useState(0)
  const appliedPrefillKey = useRef<string | null>(null)
  const [activePicker, setActivePicker] = useState<Picker>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])
  const [pendingGif, setPendingGif] = useState<PendingGif | null>(null)
  const [pollDraft, setPollDraft] = useState<PollDraft | null>(null)
  const [sending, setSending] = useState(false)
  const [bbSuggest, setBbSuggest] = useState<{ type: string; options: string[] } | null>(null)
  const [globalModalOpen, setGlobalModalOpen] = useState(false)
  const [cursorPos, setCursorPos] = useState(0)

  const { suggestions: hookSuggestions, trigger: mentionTrigger } = useMentionAutocomplete({
    text,
    cursorPos,
    leagueId,
    chatType,
    isCommissioner,
    leagues: autocompleteLeagues,
    sport,
  })

  /*
   * The thread's own members, after the static entries (@chimmy, @all). Matched on
   * username or display name, never duplicating a person the league search
   * already returned.
   */
  const mentionSuggestions = useMemo((): MentionSuggestion[] => {
    if (!mentionMembers?.length) return hookSuggestions
    const before = text.slice(0, cursorPos)
    const at = before.match(/@(\w*)$/)
    if (!at) return hookSuggestions
    const q = at[1]!.toLowerCase()
    const taken = new Set(hookSuggestions.map((s) => s.value.trim().toLowerCase()))
    const people: MentionSuggestion[] = []
    for (const m of mentionMembers) {
      const username = m.username?.trim()
      if (!username || !/^\w+$/.test(username)) continue
      const display = m.displayName?.trim() || ''
      if (q && !username.toLowerCase().startsWith(q) && !display.toLowerCase().includes(q)) continue
      const value = `@${username} `
      if (taken.has(value.trim().toLowerCase())) continue
      taken.add(value.trim().toLowerCase())
      people.push({
        type: '@username',
        value,
        label: `@${username}`,
        description: display || undefined,
        avatarUrl: m.avatarUrl ?? undefined,
      })
      if (people.length >= 8) break
    }
    return [...hookSuggestions, ...people]
  }, [hookSuggestions, mentionMembers, text, cursorPos])

  const showBbChimmySuggest = Boolean(bbSuggest?.options?.length)
  const showMentionSuggest = mentionSuggestions.length > 0 && !showBbChimmySuggest

  const applyMentionSelection = useCallback(
    (s: MentionSuggestion) => {
      const ta = textareaRef.current
      const pos = ta?.selectionStart ?? cursorPos
      const before = text.slice(0, pos)
      const after = text.slice(pos)
      if (s.type === '@global') {
        setGlobalModalOpen(true)
        const newBefore = before.replace(/@\w*$/, '')
        setText(newBefore + after)
        queueMicrotask(() => {
          const p = newBefore.length
          ta?.setSelectionRange(p, p)
          ta?.focus()
          setCursorPos(p)
        })
        return
      }
      /*
       * Replace whatever opened the list. A `#` suggestion matched a query that
       * may contain spaces, so the pattern has to cover the same span the hook
       * matched — replacing only `#\w*` would leave half a player's name behind.
       */
      const newBefore =
        mentionTrigger === '#'
          ? before.replace(/#[\w']*(?: [\w']*){0,2}$/, s.value)
          : before.replace(/@\w*$/, s.value)
      setText(newBefore + after)
      queueMicrotask(() => {
        const p = newBefore.length
        ta?.setSelectionRange(p, p)
        ta?.focus()
        setCursorPos(p)
      })
    },
    [cursorPos, text, mentionTrigger]
  )

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [])

  useEffect(() => {
    autoResize()
  }, [text, autoResize])

  useEffect(() => {
    appliedPrefillKey.current = null
  }, [leagueId])

  useEffect(() => {
    const leagueForSuggest =
      bigBrotherAutocompleteLeagueId ?? c2cAutocompleteLeagueId ?? idpAutocompleteLeagueId
    if (!leagueForSuggest || !text.toLowerCase().includes('@chimmy')) {
      setBbSuggest(null)
      return
    }
    const path = bigBrotherAutocompleteLeagueId
      ? `/api/leagues/${encodeURIComponent(bigBrotherAutocompleteLeagueId)}/big-brother/chimmy-autocomplete?draft=${encodeURIComponent(text)}`
      : c2cAutocompleteLeagueId
        ? `/api/c2c/chimmy-autocomplete?leagueId=${encodeURIComponent(c2cAutocompleteLeagueId)}&draft=${encodeURIComponent(text)}`
        : `/api/leagues/${encodeURIComponent(idpAutocompleteLeagueId!)}/idp/chimmy-autocomplete?draft=${encodeURIComponent(text)}`
    const handle = window.setTimeout(() => {
      void fetch(path, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { type?: string; options?: string[] } | null) => {
          if (!d?.options?.length) {
            setBbSuggest(null)
            return
          }
          setBbSuggest({ type: d.type ?? 'command', options: d.options })
        })
        .catch(() => setBbSuggest(null))
    }, 180)
    return () => window.clearTimeout(handle)
  }, [text, bigBrotherAutocompleteLeagueId, c2cAutocompleteLeagueId, idpAutocompleteLeagueId])

  useEffect(() => {
    if (!initialDraftText?.trim()) return
    const key = `${leagueId}:${initialDraftText}`
    if (appliedPrefillKey.current === key) return
    appliedPrefillKey.current = key
    setText(initialDraftText)
    queueMicrotask(() => {
      textareaRef.current?.focus()
      autoResize()
    })
  }, [leagueId, initialDraftText, autoResize])

  const insertChar = useCallback((char: string) => {
    const ta = textareaRef.current
    if (!ta) {
      setText((t) => t + char)
      return
    }
    setText((prev) => {
      const s = ta.selectionStart ?? prev.length
      const e = ta.selectionEnd ?? prev.length
      const next = prev.slice(0, s) + char + prev.slice(e)
      const pos = s + char.length
      queueMicrotask(() => {
        ta.setSelectionRange(pos, pos)
        ta.focus()
      })
      return next
    })
  }, [])

  const uploadFile = useCallback(
    async (file: File, type: 'image' | 'video' | 'voice') => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('type', type)
      // One of the two is always present; the endpoint authorises against whichever it gets.
      if (leagueId) fd.append('leagueId', leagueId)
      if (threadId) fd.append('threadId', threadId)
      const res = await fetch('/api/chat/upload', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; mimeType?: string }
      if (!res.ok || !data.url) {
        toast.error(data.error || 'Upload failed')
        return null
      }
      return { url: data.url, mimeType: data.mimeType ?? file.type }
    },
    [leagueId, threadId]
  )

  /*
   * ONE path for every way a photo arrives — the 📷 button, a drop onto the
   * conversation, a paste. Three entry points with three sets of checks is how one
   * of them ends up accepting a 90 MB HEIC the server will refuse after uploading it.
   * Each photo lands in the preview row with its own ✕, so nothing is sent until
   * the writer presses send.
   */
  const attachmentCount = useRef(0)
  attachmentCount.current = attachments.length
  const addImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const room = Math.max(0, MAX_IMAGES_PER_MESSAGE - attachmentCount.current - uploading)
      if (room === 0) {
        toast.error(`Up to ${MAX_IMAGES_PER_MESSAGE} photos per message.`)
        return
      }
      const accepted: File[] = []
      for (const f of files) {
        const why = imageRejection(f)
        if (why) {
          toast.error(why)
          continue
        }
        accepted.push(f)
      }
      if (accepted.length > room) {
        toast.error(`Up to ${MAX_IMAGES_PER_MESSAGE} photos per message — added the first ${room}.`)
      }
      const batch = accepted.slice(0, room)
      if (batch.length === 0) return
      setUploading((n) => n + batch.length)
      await Promise.all(
        batch.map(async (file) => {
          try {
            const r = await uploadFile(file, 'image')
            if (r) setAttachments((a) => [...a, { type: 'image', url: r.url, mimeType: r.mimeType, name: file.name }])
          } catch {
            toast.error('Photo upload failed. Check your connection and try again.')
          } finally {
            setUploading((n) => Math.max(0, n - 1))
          }
        }),
      )
    },
    [uploadFile, uploading],
  )

  const onImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    await addImages(files)
  }

  /*
   * Drag-and-drop onto the whole conversation, not just the text box — the drop
   * target people aim at is the chat they are looking at. Only drags that carry
   * FILES light it up; dragging selected text around must not.
   */
  const addImagesRef = useRef(addImages)
  addImagesRef.current = addImages
  useEffect(() => {
    const zone = dropZoneRef?.current
    if (!zone) return
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const clear = () => {
      depth = 0
      zone.removeAttribute('data-af-drop')
    }
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth += 1
      zone.setAttribute('data-af-drop', 'active')
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) zone.removeAttribute('data-af-drop')
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      clear()
      void addImagesRef.current(Array.from(e.dataTransfer?.files ?? []))
    }
    zone.addEventListener('dragenter', onEnter)
    zone.addEventListener('dragover', onOver)
    zone.addEventListener('dragleave', onLeave)
    zone.addEventListener('drop', onDrop)
    return () => {
      zone.removeEventListener('dragenter', onEnter)
      zone.removeEventListener('dragover', onOver)
      zone.removeEventListener('dragleave', onLeave)
      zone.removeEventListener('drop', onDrop)
      clear()
    }
  }, [dropZoneRef])

  const onVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = url
    try {
      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res()
        video.onerror = () => rej(new Error('bad'))
      })
      if (video.duration > 120) {
        toast.error('Video must be under 2 minutes')
        URL.revokeObjectURL(url)
        return
      }
    } catch {
      toast.error('Could not read video')
      URL.revokeObjectURL(url)
      return
    }
    URL.revokeObjectURL(url)
    const r = await uploadFile(file, 'video')
    if (!r) return
    setAttachments((a) => [
      ...a,
      {
        type: 'video',
        url: r.url,
        mimeType: r.mimeType,
        name: file.name,
        duration: video.duration,
      },
    ])
  }

  /*
   * Not while a photo is still uploading: the writer meant the words and the
   * picture together, and sending now would post the text alone and strand the
   * photo in the preview row.
   */
  const canSend =
    uploading === 0 &&
    (text.trim().length > 0 || Boolean(pendingGif) || attachments.length > 0 || Boolean(pollDraft))

  const handleSend = useCallback(async () => {
    if (!canSend || sending) return
    setSending(true)
    // Optimistically clear input and attachments immediately
    const prevText = text
    const prevGif = pendingGif
    const prevAttachments = attachments
    const prevPoll = pollDraft
    setText('')
    setPendingGif(null)
    setAttachments([])
    setPollDraft(null)
    setActivePicker(null)
    onTypingChange?.(false)
    queueMicrotask(() => {
      const el = textareaRef.current
      if (el) {
        el.style.height = 'auto'
        autoResize()
      }
    })
    try {
      const payload: LeagueComposerPayload = {
        text: prevText.trim(),
        ...(prevGif && {
          gifId: prevGif.id,
          giphyId: prevGif.giphyId,
          gifUrl: prevGif.url,
          previewUrl: prevGif.previewUrl,
          gifTitle: prevGif.title,
        }),
        ...(prevAttachments.length ? { attachments: prevAttachments.map((a) => ({ ...a })) } : {}),
        ...(prevPoll ? { poll: { ...prevPoll } } : {}),
      }
      await onSend(payload)
    } catch (err) {
      /*
       * 🛑 PUT THE MESSAGE BACK. The clear above is optimistic and happens BEFORE the send,
       * so without this a failure destroys what the user typed — silently, because there was
       * no catch here at all and `finally` only reset the spinner.
       *
       * Reported after a send while the browser was offline: the composer emptied, no
       * request left the machine, no error appeared, and the message was simply gone. The
       * console showed `net::ERR_INTERNET_DISCONNECTED` on an unrelated endpoint, which is
       * the only reason the cause was findable at all.
       *
       * ⚠ RESTORE FIRST, THEN REPORT. If the toast throws or is suppressed, the user still
       * has their text back — the draft matters more than the notification.
       */
      setText(prevText)
      setPendingGif(prevGif)
      setAttachments(prevAttachments)
      setPollDraft(prevPoll)

      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      toast.error(
        offline
          ? "You're offline — message not sent. It's back in the box, try again when you reconnect."
          : `Message not sent${err instanceof Error && err.message ? ` (${err.message})` : ''}. It's back in the box.`,
      )
    } finally {
      setSending(false)
    }
  }, [attachments, autoResize, canSend, onSend, onTypingChange, pendingGif, pollDraft, sending, text])

  const toolBtn = (active: boolean) =>
    `af-chat-tool px-1.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
      active ? 'text-cyan-400 bg-cyan-500/10' : 'text-white/40 hover:text-white hover:bg-white/[0.06]'
    }`

  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      data-testid="league-chat-composer"
      data-current-user-id={currentUserId ?? ''}
    >
      <AttachmentPreview
        gif={pendingGif}
        attachments={attachments}
        poll={pollDraft}
        onRemoveGif={() => setPendingGif(null)}
        onRemoveAttachment={(i) => setAttachments((a) => a.filter((_, j) => j !== i))}
        onRemovePoll={() => setPollDraft(null)}
        onEditPoll={() => setActivePicker('poll')}
      />
      {uploading > 0 ? (
        <p className="af-chat-uploading mb-1 px-1 text-[11px] text-white/60" role="status" aria-live="polite">
          Uploading {uploading === 1 ? 'photo' : `${uploading} photos`}…
        </p>
      ) : null}

      <div className="relative w-full">
        {activePicker === 'gif' ? (
          <div className="af-chat-picker absolute bottom-full left-0 right-0 z-50 mb-1">
            <GifPicker
              onSelect={(g) => {
                setPendingGif({
                  id: g.id,
                  giphyId: g.giphyId,
                  url: g.url,
                  previewUrl: g.previewUrl,
                  title: g.title,
                })
                setActivePicker(null)
              }}
              onClose={() => setActivePicker(null)}
            />
          </div>
        ) : null}
        {activePicker === 'emoji' ? (
          <div className="af-chat-picker absolute bottom-full left-0 right-0 z-50 mb-1">
            <EmojiPicker onSelect={(c) => insertChar(c)} onClose={() => setActivePicker(null)} />
          </div>
        ) : null}
        {activePicker === 'poll' ? (
          <div className="af-chat-picker absolute bottom-full left-0 right-0 z-50 mb-1">
            <PollComposer
              initial={pollDraft}
              onCreatePoll={(p) => {
                setPollDraft(p)
                setActivePicker(null)
              }}
              onCancel={() => setActivePicker(null)}
            />
          </div>
        ) : null}

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03]">
          {bbSuggest?.options.length ? (
            <div
              className="max-h-36 overflow-y-auto border-b border-white/[0.06] px-2 py-1.5"
              data-testid={
                bigBrotherAutocompleteLeagueId
                  ? 'bb-chimmy-autocomplete'
                  : c2cAutocompleteLeagueId
                    ? 'c2c-chimmy-autocomplete'
                    : 'idp-chimmy-autocomplete'
              }
            >
              {bbSuggest.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-white/85 hover:bg-cyan-500/15"
                  onClick={() => {
                    if (bbSuggest.type === 'redirect') {
                      toast.info(opt)
                      setBbSuggest(null)
                      return
                    }
                    if (opt.startsWith('@chimmy')) {
                      setText(`${opt} `)
                    } else {
                      setText((prev) => `${prev.replace(/\s+$/, '')} ${opt} `)
                    }
                    setBbSuggest(null)
                    queueMicrotask(() => textareaRef.current?.focus())
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : null}
          {showMentionSuggest ? (
            <MentionAutocomplete
              suggestions={mentionSuggestions}
              onSelect={(s) => applyMentionSelection(s)}
              onDismiss={() => {}}
            />
          ) : null}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setCursorPos(e.target.selectionStart ?? 0)
              onTypingChange?.(e.target.value.trim().length > 0)
            }}
            onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart ?? 0)}
            onBlur={() => {
              /* Walking away from a half-typed line is not "still typing". */
              if (!text.trim()) onTypingChange?.(false)
            }}
            onPaste={(e) => {
              /*
               * A pasted screenshot goes through the same checks and the same preview
               * row as the 📷 button. Pasted TEXT is left entirely to the browser.
               */
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
              if (files.length === 0) return
              e.preventDefault()
              void addImages(files)
            }}
            onClick={(e) => setCursorPos(e.currentTarget.selectionStart ?? 0)}
            onSelect={(e) => setCursorPos(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-[13px] leading-[1.4] text-white outline-none placeholder:text-white/30 min-h-[36px] max-h-[120px] overflow-y-auto"
            data-testid="league-chat-textarea"
          />

          {isRecording ? (
            <VoiceRecorder
              leagueId={leagueId}
              onComplete={(p) => {
                setAttachments((a) => [
                  ...a,
                  {
                    type: 'voice',
                    url: p.url,
                    duration: p.duration,
                    mimeType: p.mimeType,
                    name: p.name,
                  },
                ])
                setIsRecording(false)
              }}
              onCancel={() => setIsRecording(false)}
            />
          ) : (
            <div className="flex items-center gap-1 px-2 pb-2 pt-1">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
                <button
                  type="button"
                  className={toolBtn(activePicker === 'gif')}
                  onClick={() => setActivePicker((p) => (p === 'gif' ? null : 'gif'))}
                  aria-label="GIF"
                  aria-pressed={activePicker === 'gif'}
                >
                  GIF
                </button>
                <button
                  type="button"
                  className={toolBtn(activePicker === 'emoji')}
                  onClick={() => setActivePicker((p) => (p === 'emoji' ? null : 'emoji'))}
                  aria-label="Emoji"
                >
                  😀
                </button>
                <button
                  type="button"
                  className={toolBtn(activePicker === 'poll')}
                  onClick={() => setActivePicker((p) => (p === 'poll' ? null : 'poll'))}
                  aria-label="Poll"
                >
                  📊
                </button>
                <button
                  type="button"
                  className={toolBtn(false)}
                  onClick={() => setIsRecording(true)}
                  aria-label="Voice note"
                >
                  🎤
                </button>
                <button
                  type="button"
                  className={toolBtn(false)}
                  onClick={() => imageInputRef.current?.click()}
                  aria-label="Photo"
                  title="Add photos — or drop / paste them into the chat"
                >
                  📷
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  className="hidden"
                  onChange={onImageChange}
                />
                <button
                  type="button"
                  className={toolBtn(false)}
                  onClick={() => videoInputRef.current?.click()}
                  aria-label="Video"
                >
                  🎥
                </button>
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={onVideoChange}
                />
              </div>

              <div className="flex flex-shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!canSend || sending}
                  className="af-chat-send rounded-lg p-1.5 text-white/40 transition-colors hover:bg-cyan-500/10 hover:text-cyan-400 disabled:opacity-40"
                  aria-label="Send league message"
                  data-testid="league-chat-send"
                >
                  <Send size={14} strokeWidth={2} />
                </button>
                {onAskChimmy ? (
                  <button
                    type="button"
                    onClick={onAskChimmy}
                    className="af-chat-ask-chimmy rounded-md bg-violet-500/20 px-2 py-1.5 text-[11px] font-bold text-violet-300 transition-colors hover:bg-violet-500/30"
                  >
                    Ask Chimmy
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <GlobalBroadcastModal
        isOpen={globalModalOpen}
        onClose={() => setGlobalModalOpen(false)}
        commissionerLeagues={commissionerLeagues}
        onSend={async () => {}}
      />
    </div>
  )
}

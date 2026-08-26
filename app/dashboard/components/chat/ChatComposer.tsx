'use client'

import { Send } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
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
  poll?: { question: string; options: string[]; closeAt: Date; allowMultiple: boolean }
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
}: ChatComposerProps) {
  const [text, setText] = useState('')
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

  const { suggestions: mentionSuggestions, trigger: mentionTrigger } = useMentionAutocomplete({
    text,
    cursorPos,
    leagueId,
    chatType,
    isCommissioner,
    leagues: autocompleteLeagues,
    sport,
  })

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

  const onImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const r = await uploadFile(file, 'image')
    if (!r) return
    setAttachments((a) => [...a, { type: 'image', url: r.url, mimeType: r.mimeType, name: file.name }])
  }

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

  const canSend =
    text.trim().length > 0 ||
    Boolean(pendingGif) ||
    attachments.length > 0 ||
    Boolean(pollDraft)

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
    } finally {
      setSending(false)
    }
  }, [attachments, autoResize, canSend, onSend, pendingGif, pollDraft, sending, text])

  const toolBtn = (active: boolean) =>
    `px-1.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
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

      <div className="relative w-full">
        {activePicker === 'gif' ? (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-1">
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
          <div className="absolute bottom-full left-0 right-0 z-50 mb-1">
            <EmojiPicker onSelect={(c) => insertChar(c)} onClose={() => setActivePicker(null)} />
          </div>
        ) : null}
        {activePicker === 'poll' ? (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-1">
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
            }}
            onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart ?? 0)}
            onClick={(e) => setCursorPos(e.currentTarget.selectionStart ?? 0)}
            onSelect={(e) => setCursorPos(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
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
                >
                  📷
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
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
                  className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-cyan-500/10 hover:text-cyan-400 disabled:opacity-40"
                  aria-label="Send league message"
                  data-testid="league-chat-send"
                >
                  <Send size={14} strokeWidth={2} />
                </button>
                {onAskChimmy ? (
                  <button
                    type="button"
                    onClick={onAskChimmy}
                    className="rounded-md bg-violet-500/20 px-2 py-1.5 text-[11px] font-bold text-violet-300 transition-colors hover:bg-violet-500/30"
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

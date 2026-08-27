'use client'

export type PendingGif = {
  id?: string
  giphyId: string
  url: string
  previewUrl: string
  title: string
}

export type UploadedAttachment = {
  type: 'image' | 'video' | 'voice'
  url: string
  duration?: number
  mimeType?: string
  name?: string
}

export type PollDraft = {
  question: string
  options: string[]
  closeAt: Date
  allowMultiple: boolean
  /** Hide WHO voted. Enforced on the server, not by the client declining to render it. */
  anonymous?: boolean
}

type AttachmentPreviewProps = {
  gif: PendingGif | null
  attachments: UploadedAttachment[]
  poll: PollDraft | null
  onRemoveGif: () => void
  onRemoveAttachment: (index: number) => void
  onRemovePoll: () => void
  onEditPoll?: () => void
}

export function AttachmentPreview({
  gif,
  attachments,
  poll,
  onRemoveGif,
  onRemoveAttachment,
  onRemovePoll,
  onEditPoll,
}: AttachmentPreviewProps) {
  if (!gif && attachments.length === 0 && !poll) return null

  return (
    <div className="mb-2 flex flex-wrap gap-2 px-1">
      {gif ? (
        <div className="flex max-w-[200px] items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] p-1.5 pr-2">
          <img src={gif.previewUrl || gif.url} alt="" className="h-[80px] w-[80px] shrink-0 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-medium text-white/70">{gif.title}</p>
            <p className="text-[9px] text-white/35">GIF</p>
          </div>
          <button
            type="button"
            onClick={onRemoveGif}
            className="shrink-0 rounded p-1 text-white/40 hover:bg-white/[0.08] hover:text-white"
            aria-label="Remove GIF"
          >
            ×
          </button>
        </div>
      ) : null}

      {attachments.map((a, i) => (
        <div
          key={`${a.url}-${i}`}
          className="flex max-w-[200px] items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] p-1.5 pr-2"
        >
          {a.type === 'image' ? (
            <img src={a.url} alt="" className="h-[60px] w-[60px] shrink-0 rounded-lg object-cover" />
          ) : null}
          {a.type === 'video' ? (
            <video src={a.url} className="h-[60px] w-[60px] shrink-0 rounded-lg object-cover" muted playsInline />
          ) : null}
          {a.type === 'voice' ? (
            <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-lg">
              🎤
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] text-white/70">{a.name || a.type}</p>
            {a.duration != null ? (
              <p className="text-[9px] text-white/35">
                {a.type === 'voice' ? `Voice · ${Math.round(a.duration)}s` : `${Math.round(a.duration)}s`}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onRemoveAttachment(i)}
            className="shrink-0 rounded p-1 text-white/40 hover:bg-white/[0.08] hover:text-white"
            aria-label="Remove attachment"
          >
            ×
          </button>
        </div>
      ))}

      {poll ? (
        <button
          type="button"
          onClick={onEditPoll}
          className="flex max-w-full items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-left"
        >
          <span className="text-[12px]">📊</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-cyan-200/90">Poll: {poll.question}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onRemovePoll()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onRemovePoll()
              }
            }}
            className="shrink-0 rounded p-1 text-white/40 hover:text-white"
            aria-label="Remove poll"
          >
            ×
          </span>
        </button>
      ) : null}
    </div>
  )
}

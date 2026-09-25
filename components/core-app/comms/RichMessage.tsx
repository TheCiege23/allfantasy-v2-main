'use client'

/**
 * Rendering for the message types the composer can already SEND.
 *
 * ⚠ THE SENDING SIDE SHIPPED WITHOUT THIS. `ChatComposer` has produced GIFs,
 * images, voice/video and polls since it was written, and the one panel that
 * used it carried a `console.log` and the note "until UI renders all types".
 * So a GIF could be posted and then appeared as the literal text "🎬 GIF".
 * Sending a thing the reader cannot see is worse than not offering to send it.
 *
 * ⚠ EVERYTHING COMES OUT OF `metadata`, WHICH IS UNTRUSTED JSON. Every field is
 * checked before use and a malformed shape renders nothing rather than throwing
 * inside a message list — one bad row must not blank the whole conversation.
 */

import { useState } from 'react'
import { readViewerPoll } from '@/lib/chat-core/messagePolls'
import { gifCredit, readGif, readSafeGif } from '@/lib/rich-message/RichMessageRenderer'
import { getSafeMessageMediaUrl } from '@/lib/rich-message/safeMedia'
import { MessagePoll } from './MessagePoll'
import { TradeCardView } from './TradeCardView'
import { readTradeOffer, readTradeOfferStatus } from '@/lib/chat-notifications/tradeOfferCard'
import { ImageViewer } from './ImageViewer'

/*
 * The GIF parse lives beside the /messages renderer, so both surfaces read BOTH
 * wire shapes through one function. Re-exported here for existing importers.
 */
export { readGif, readSafeGif }
export type { SafeGif } from '@/lib/rich-message/RichMessageRenderer'

export type RichMetadata = Record<string, unknown> | null | undefined

type Attachment = { type: string; url: string; mimeType?: string; duration?: number }
type Poll = { question: string; options: Array<{ id: string; text: string; votes: string[] }> }
type TradeAsset = { id: string; name: string | null; position?: string | null; team?: string | null }
type TradeCard = {
  manager: string
  gave: TradeAsset[]
  got: TradeAsset[]
  picksGave: number
  picksGot: number
  season: number | null
  week: number | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

export function readAttachments(meta: RichMetadata): Attachment[] {
  if (!meta || !Array.isArray(meta.attachments)) return []
  // A plain loop rather than map+filter: the source is `unknown[]`, so a type
  // predicate has nothing to narrow FROM and TypeScript rejects it.
  const out: Attachment[] = []
  for (const raw of meta.attachments as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const a = raw as Record<string, unknown>
    const url = str(a.url)
    const type = str(a.type)
    if (!url || !type) continue
    out.push({ type, url, mimeType: str(a.mimeType) ?? undefined })
  }
  return out
}

export function readPoll(meta: RichMetadata): Poll | null {
  if (!meta || !meta.poll || typeof meta.poll !== 'object' || Array.isArray(meta.poll)) return null
  const p = meta.poll as Record<string, unknown>
  const question = str(p.question)
  if (!question || !Array.isArray(p.options)) return null
  const options: Poll['options'] = []
  ;(p.options as unknown[]).forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return
    const o = raw as Record<string, unknown>
    const text = str(o.text)
    if (!text) return
    options.push({
      id: str(o.id) ?? `opt-${i}`,
      text,
      votes: Array.isArray(o.votes)
        ? (o.votes as unknown[]).filter((v): v is string => typeof v === 'string')
        : [],
    })
  })
  if (options.length === 0) return null
  return { question, options }
}

/**
 * The rich half of a message. Returns null when there is nothing beyond text, so
 * an ordinary message renders exactly as it did before.
 */
function readTradeCard(meta: RichMetadata): TradeCard | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as Record<string, unknown>).tradeCard
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as Record<string, unknown>

  const side = (v: unknown): TradeAsset[] => {
    if (!Array.isArray(v)) return []
    const out: TradeAsset[] = []
    for (const entry of v) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const id = str(e.id)
      if (!id) continue
      out.push({
        id,
        name: str(e.name),
        position: str(e.position),
        team: str(e.team),
      })
    }
    return out
  }

  const manager = str(t.manager)
  if (!manager) return null

  return {
    manager,
    gave: side(t.gave),
    got: side(t.got),
    picksGave: typeof t.picksGave === 'number' ? t.picksGave : 0,
    picksGot: typeof t.picksGot === 'number' ? t.picksGot : 0,
    season: typeof t.season === 'number' ? t.season : null,
    week: typeof t.week === 'number' ? t.week : null,
  }
}

export function RichMessage({
  metadata,
  viewerUserId,
  onVote,
  onClosePoll,
  messageType,
  body,
}: {
  metadata: RichMetadata
  /*
   * Both optional. Without them the poll renders exactly as it always has —
   * read-only — which is what the DM and huddle panel still needs, because the
   * vote route has no branch for a platform thread this app actually creates.
   */
  viewerUserId?: string | null
  onVote?: (optionId: string) => void
  /** Only passed when the viewer wrote the poll or runs the league. */
  onClosePoll?: () => void
  /** With `body`, lets a type-`gif` row (URL as body) render as the GIF it is. */
  messageType?: string | null
  body?: string | null
}) {
  const [viewing, setViewing] = useState<string | null>(null)
  const gif = readSafeGif(metadata, messageType, body)
  const attachments = readSafeAttachments(metadata)
  const poll = readPoll(metadata)
  const trade = readTradeCard(metadata)
  /*
   * A trade offer posted into the two managers' DM, or the line under it when it is answered. Neither
   * fits the completed-trade shape `readTradeCard` narrows to, so TradeCardView reads them from the raw
   * metadata — without this check the DM showed the offer as plain text and never drew the card.
   */
  const tradeOffer = metadata ? readTradeOffer(metadata) != null || readTradeOfferStatus(metadata) != null : false
  const viewerPoll = onVote ? readViewerPoll(metadata, viewerUserId ?? null) : null
  if (!gif && attachments.length === 0 && !poll && !trade && !tradeOffer) return null

  return (
    <div className="af-cm-rich">
      {gif ? (
        <figure className="af-cm-gif">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={gif.previewUrl || gif.url} alt={gif.title} loading="lazy" />
          {/* Each GIF service's terms require visible attribution wherever its GIFs render. */}
          <figcaption>{gifCredit(gif.provider)}</figcaption>
        </figure>
      ) : null}

      {attachments.map((a) => {
        if (a.type === 'image') {
          /*
           * A button around the picture, not a bare <img>: tapping opens the whole
           * frame. Sleeper's reviews complain that enlarging a chat image crops a
           * quarter of it — the viewer fits the full picture instead.
           */
          return (
            <button
              key={a.url}
              type="button"
              className="af-cm-attach-btn"
              onClick={() => setViewing(a.url)}
              aria-label="Open image full size"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="af-cm-attach" src={a.url} alt="" loading="lazy" />
            </button>
          )
        }
        if (a.type === 'video') {
          return <video key={a.url} className="af-cm-attach" src={a.url} controls preload="metadata" />
        }
        if (a.type === 'voice') {
          return <audio key={a.url} className="af-cm-audio" src={a.url} controls preload="metadata" />
        }
        return null
      })}

      {trade || tradeOffer ? <TradeCardView card={trade} metadata={metadata ?? null} viewerUserId={viewerUserId ?? null} /> : null}

      {viewerPoll && onVote ? (
        <MessagePoll poll={viewerPoll} onVote={onVote} onClose={onClosePoll} />
      ) : poll ? (
        <div className="af-cm-poll">
          <p className="af-cm-poll-q">{poll.question}</p>
          {poll.options.map((o) => (
            <div key={o.id} className="af-cm-poll-o">
              <span>{o.text}</span>
              {/*
                A count, not a bar. Read-only here because nothing on this surface
                can vote yet, and a bar drawn from one number with no denominator
                invents a proportion.
              */}
              <span className="af-cm-poll-n af-num">{o.votes.length}</span>
            </div>
          ))}
        </div>
      ) : null}

      {viewing ? <ImageViewer src={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  )
}

/**
 * Attachments whose URL is safe to put in a src: https or a same-origin path.
 * `readAttachments` is the raw parse; this is what actually renders.
 */
export function readSafeAttachments(meta: RichMetadata): Attachment[] {
  const out: Attachment[] = []
  for (const a of readAttachments(meta)) {
    const url = getSafeMessageMediaUrl(a.url)
    if (url) out.push({ ...a, url })
  }
  return out
}

/** Whether `RichMessage` will draw anything — the bubble uses it to drop "🎬 GIF"-style fallback labels. */
export function hasRichContent(metadata: RichMetadata, messageType?: string | null, body?: string | null): boolean {
  return Boolean(
    readSafeGif(metadata, messageType, body) ||
      readSafeAttachments(metadata).length > 0 ||
      readPoll(metadata) ||
      readTradeCard(metadata),
  )
}

export default RichMessage

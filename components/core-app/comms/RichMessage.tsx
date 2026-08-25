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

import { readViewerPoll } from '@/lib/chat-core/messagePolls'
import { MessagePoll } from './MessagePoll'

export type RichMetadata = Record<string, unknown> | null | undefined

type Gif = { previewUrl: string; url: string; title: string }
type Attachment = { type: string; url: string; mimeType?: string; duration?: number }
type Poll = { question: string; options: Array<{ id: string; text: string; votes: string[] }> }

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

/**
 * A GIF arrives in two shapes: a nested `gif` object, or flat `gifUrl` /
 * `previewUrl` keys. Both are written by the same composer depending on path,
 * so both are read here.
 */
export function readGif(meta: RichMetadata): Gif | null {
  if (!meta) return null
  const nested = meta.gif
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const g = nested as Record<string, unknown>
    const preview = str(g.previewUrl)
    const url = str(g.url)
    if (preview || url) {
      return {
        previewUrl: preview ?? url ?? '',
        url: url ?? preview ?? '',
        title: str(g.title) ?? 'GIF',
      }
    }
  }
  const preview = str(meta.previewUrl) ?? str(meta.gifUrl)
  const url = str(meta.gifUrl) ?? preview
  if (!preview && !url) return null
  return { previewUrl: preview ?? url ?? '', url: url ?? preview ?? '', title: str(meta.gifTitle) ?? 'GIF' }
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
export function RichMessage({
  metadata,
  viewerUserId,
  onVote,
}: {
  metadata: RichMetadata
  /*
   * Both optional. Without them the poll renders exactly as it always has —
   * read-only — which is what the DM and huddle panel still needs, because the
   * vote route has no branch for a platform thread this app actually creates.
   */
  viewerUserId?: string | null
  onVote?: (optionId: string) => void
}) {
  const gif = readGif(metadata)
  const attachments = readAttachments(metadata)
  const poll = readPoll(metadata)
  const viewerPoll = onVote ? readViewerPoll(metadata, viewerUserId ?? null) : null
  if (!gif && attachments.length === 0 && !poll) return null

  return (
    <div className="af-cm-rich">
      {gif ? (
        <figure className="af-cm-gif">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={gif.previewUrl || gif.url} alt={gif.title} loading="lazy" />
          {/* Giphy's terms require visible attribution wherever their GIFs render. */}
          <figcaption>via GIPHY</figcaption>
        </figure>
      ) : null}

      {attachments.map((a) => {
        if (a.type === 'image') {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={a.url} className="af-cm-attach" src={a.url} alt="" loading="lazy" />
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

      {viewerPoll && onVote ? (
        <MessagePoll poll={viewerPoll} onVote={onVote} />
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
    </div>
  )
}

export default RichMessage

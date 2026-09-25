"use client"

import React from "react"
import Image from "next/image"
import type { PlatformChatMessage } from "@/types/platform-shared"
import { getSafeMessageMediaUrl } from "./safeMedia"
import { gifProviderForUrl, isAllowedGifUrl } from "./GIFIntegrationResolver"

export type RichMessageRendererProps = {
  message: PlatformChatMessage
  onImageClick?: (url: string) => void
  className?: string
  style?: React.CSSProperties
}

type RichMeta = Record<string, unknown> | null | undefined

export type MessageGif = { previewUrl: string; url: string; title: string }
export type SafeGif = MessageGif & { provider: "klipy" | "giphy" | "tenor" }

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null
}

/**
 * The raw GIF fields a message's metadata carries, from either key layout: a
 * nested `gif` object, or flat `gifUrl` / `previewUrl` keys. Both are written by
 * the same composer depending on path, so both are read here.
 *
 * ⚠ RAW. This will hand back any string at all. `readSafeGif` is the gate for
 * putting one in an <img>.
 */
export function readGif(meta: RichMeta): MessageGif | null {
  if (!meta) return null
  const nested = meta.gif
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const g = nested as Record<string, unknown>
    const preview = str(g.previewUrl)
    const url = str(g.url)
    if (preview || url) {
      return {
        previewUrl: preview ?? url ?? "",
        url: url ?? preview ?? "",
        title: str(g.title) ?? "GIF",
      }
    }
  }
  const preview = str(meta.previewUrl) ?? str(meta.gifUrl)
  const url = str(meta.gifUrl) ?? preview
  if (!preview && !url) return null
  return { previewUrl: preview ?? url ?? "", url: url ?? preview ?? "", title: str(meta.gifTitle) ?? "GIF" }
}

/**
 * The GIF a message should SHOW, from either wire shape — or null.
 *
 * ⚠ TWO SHAPES, ONE READER, AND THAT IS THE BUG THIS FIXES. The shared composer
 * (comms drawer, dashboard) puts the GIF in `metadata` with "🎬 GIF" as the body;
 * the full league panel and /messages send `messageType: "gif"` with the URL AS
 * the body. Each renderer read only its own shape, so a GIF sent from one surface
 * arrived in the other as the words "🎬 GIF", or as a bare link.
 *
 * ⚠ ONLY FROM A GIF SERVICE WE CAN NAME AND CREDIT: https, on Klipy / GIPHY /
 * Tenor's own hosts (`isAllowedGifUrl`). A GIF is the one media type anybody can
 * aim at an arbitrary URL just by pasting it, so an unknown host renders nothing.
 */
export function readSafeGif(meta: RichMeta, messageType?: string | null, body?: string | null): SafeGif | null {
  const candidates: MessageGif[] = []
  const fromMeta = readGif(meta)
  if (fromMeta) candidates.push(fromMeta)
  if (messageType === "gif" && typeof body === "string") {
    const url = body.trim()
    if (url) candidates.push({ previewUrl: url, url, title: "GIF" })
  }
  for (const g of candidates) {
    const url = isAllowedGifUrl(g.url) ? g.url : isAllowedGifUrl(g.previewUrl) ? g.previewUrl : null
    if (!url) continue
    const preview = isAllowedGifUrl(g.previewUrl) ? g.previewUrl : url
    const provider = gifProviderForUrl(preview) ?? gifProviderForUrl(url)
    if (!provider) continue
    return { previewUrl: preview, url, title: g.title, provider }
  }
  return null
}

/** Each service's terms want its own name under its GIFs — never a blanket "GIPHY". */
export function gifCredit(provider: SafeGif["provider"]): string {
  return provider === "klipy" ? "via KLIPY" : provider === "giphy" ? "via GIPHY" : "via Tenor"
}

/** Image attachments the shared composer stores in `metadata.attachments`. */
function readImageAttachments(meta: RichMeta): string[] {
  if (!meta || !Array.isArray(meta.attachments)) return []
  const out: string[] = []
  for (const raw of meta.attachments as unknown[]) {
    if (!raw || typeof raw !== "object") continue
    const a = raw as Record<string, unknown>
    if (a.type !== "image") continue
    const url = getSafeMessageMediaUrl(typeof a.url === "string" ? a.url : "")
    if (url) out.push(url)
  }
  return out
}

/* The body a shared-composer sender writes when the real content is the GIF / media. */
const FALLBACK_LABELS = new Set(["🎬 GIF", "📎 Media"])

function GifFigure({ gif, onImageClick }: { gif: SafeGif; onImageClick?: (url: string) => void }) {
  return (
    <figure className="m-0">
      <Image
        src={gif.previewUrl || gif.url}
        alt={gif.title || "GIF"}
        width={800}
        height={600}
        unoptimized
        className="max-w-full max-h-[280px] w-auto h-auto rounded-lg object-contain cursor-pointer"
        loading="lazy"
        onClick={() => onImageClick?.(gif.url)}
      />
      <figcaption className="mt-0.5 text-[10px] opacity-60">{gifCredit(gif.provider)}</figcaption>
    </figure>
  )
}

/**
 * Renders a single chat message with support for text, image, gif, and file.
 * Safe rendering: only allow https or relative URLs for media, and only named
 * GIF services for GIFs.
 */
export function RichMessageRenderer({ message, onImageClick, className, style }: RichMessageRendererProps) {
  const type = message.messageType || "text"
  const body = message.body || ""
  const meta = (message.metadata || {}) as Record<string, unknown>
  const alt = typeof meta.alt === "string" ? meta.alt : undefined
  const filename = typeof meta.filename === "string" ? meta.filename : "file"

  if (type === "media") {
    try {
      const payload = typeof body === "string" ? JSON.parse(body) : body
      const mediaUrl = typeof payload?.mediaUrl === "string" ? payload.mediaUrl : ""
      const url = getSafeMessageMediaUrl(mediaUrl)
      if (url) {
        return (
          <div className={className} style={style}>
            <Image
              src={url}
              alt={typeof payload?.caption === "string" ? payload.caption : "Media"}
              width={800}
              height={600}
              unoptimized
              className="max-w-full max-h-[280px] rounded-lg object-contain cursor-pointer"
              loading="lazy"
              onClick={() => onImageClick?.(url)}
            />
          </div>
        )
      }
    } catch {
      // fall through to text
    }
  }

  if (type === "gif") {
    const gif = readSafeGif(meta, type, body)
    if (!gif) {
      return (
        <div className={className} style={style}>
          <p className="text-sm opacity-80">GIF from a site we can&apos;t show</p>
        </div>
      )
    }
    return (
      <div className={className} style={style}>
        <GifFigure gif={gif} onImageClick={onImageClick} />
      </div>
    )
  }

  if (type === "image") {
    const url = getSafeMessageMediaUrl(body)
    if (!url) {
      return (
        <div className={className} style={style}>
          <p className="text-sm opacity-80">[Unsupported media]</p>
        </div>
      )
    }
    return (
      <div className={className} style={style}>
        <Image
          src={url}
          alt={alt || "Image"}
          width={800}
          height={600}
          unoptimized
          className="max-w-full max-h-[280px] rounded-lg object-contain cursor-pointer"
          loading="lazy"
          onClick={() => onImageClick?.(url)}
        />
      </div>
    )
  }

  if (type === "file") {
    const url = getSafeMessageMediaUrl(body)
    const displayName = filename || body.split("/").pop() || "Download"
    if (!url) {
      return (
        <div className={className} style={style}>
          <span className="text-sm opacity-80">📎 {displayName}</span>
        </div>
      )
    }
    return (
      <div className={className} style={style}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline break-all"
        >
          📎 {displayName}
        </a>
      </div>
    )
  }

  /*
   * A text row that carries its GIF or images in metadata — the shared composer's
   * shape. Render them, and drop the "🎬 GIF" / "📎 Media" label that stood in for
   * them; a caption the sender actually typed stays.
   */
  const metaGif = readSafeGif(meta, null, null)
  const images = readImageAttachments(meta)
  if (metaGif || images.length > 0) {
    const text = body.trim()
    const showText = text && !FALLBACK_LABELS.has(text)
    return (
      <div className={className} style={style}>
        {showText ? <p className="mt-0.5 whitespace-pre-wrap break-words">{body}</p> : null}
        {metaGif ? <GifFigure gif={metaGif} onImageClick={onImageClick} /> : null}
        {images.map((url) => (
          <Image
            key={url}
            src={url}
            alt="Image"
            width={800}
            height={600}
            unoptimized
            className="mt-1 max-w-full max-h-[280px] rounded-lg object-contain cursor-pointer"
            loading="lazy"
            onClick={() => onImageClick?.(url)}
          />
        ))}
      </div>
    )
  }

  return (
    <p className="mt-0.5 whitespace-pre-wrap break-words" style={style}>
      {body}
    </p>
  )
}

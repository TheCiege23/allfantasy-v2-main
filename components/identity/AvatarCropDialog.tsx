"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RotateCw, ZoomIn } from "lucide-react"
import { AppModal } from "@/components/ui/AppModal"

/**
 * Square crop + rotate for a profile picture, built for a thumb on a phone.
 *
 * ⚠ PREVIEW AND OUTPUT SHARE ONE PAINT FUNCTION, PARAMETERISED ONLY BY SIZE. The classic
 * cropper bug is a preview drawn by one code path and an export drawn by another, so the
 * saved image is subtly not what the user framed. `paint()` below takes the target size and
 * scales every term by `k = size / VIEWPORT_PX`, which makes "what you see is what uploads"
 * true by construction rather than by careful matching.
 *
 * ⚠ ANIMATED GIFs NEVER REACH THIS DIALOG. Cropping one through a canvas silently flattens
 * it to a single frame, so `shouldCropBeforeUpload` sends GIFs straight to the uploader
 * untouched. Losing the animation would be a worse outcome than an uncropped avatar.
 *
 * ⚠ EXIF ORIENTATION IS REQUESTED EXPLICITLY. A phone camera stores "rotate me 90°" in
 * metadata rather than rotating pixels, and a canvas does not apply it. Without
 * `imageOrientation: 'from-image'` every portrait photo from an iPhone loads sideways, and
 * the user has to undo it by hand with the rotate button — which looks like our bug,
 * because it is.
 */

/** On-screen editing square, in CSS pixels. */
const VIEWPORT_PX = 288
/** Saved avatar edge. Larger than any place we render one, small enough to stay light. */
const OUTPUT_PX = 512
const JPEG_QUALITY = 0.9
const MAX_ZOOM = 4

/** GIF is passed through: a canvas crop would flatten the animation. */
export function shouldCropBeforeUpload(file: File): boolean {
  return file.type !== "image/gif"
}

/** PNG keeps alpha for sources that can carry it; photos stay JPEG and stay small. */
export function outputTypeFor(sourceType: string): "image/png" | "image/jpeg" {
  return sourceType === "image/png" || sourceType === "image/webp" ? "image/png" : "image/jpeg"
}

/**
 * The crop maths only ever needs dimensions, so it takes them rather than an `ImageBitmap`.
 * That keeps `coverScale` and `clampOffsets` — where the actual invariants live — unit
 * testable in node, with no canvas and no image decoding.
 */
export interface ImageSize {
  width: number
  height: number
}

export interface Transform {
  /** Viewport pixels per image pixel. */
  scale: number
  offsetX: number
  offsetY: number
  /** Whole quarter turns only — enough for "my photo is sideways", no free rotation. */
  rotation: 0 | 90 | 180 | 270
}

function paint(
  ctx: CanvasRenderingContext2D,
  size: number,
  bmp: ImageBitmap,
  t: Transform,
): void {
  const k = size / VIEWPORT_PX
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.translate(size / 2 + t.offsetX * k, size / 2 + t.offsetY * k)
  ctx.rotate((t.rotation * Math.PI) / 180)
  const s = t.scale * k
  const w = bmp.width * s
  const h = bmp.height * s
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h)
  ctx.restore()
}

/** On-screen bounding box of the rotated image, in viewport pixels. */
export function displayedSize(img: ImageSize, t: Transform) {
  const swapped = t.rotation === 90 || t.rotation === 270
  return {
    w: (swapped ? img.height : img.width) * t.scale,
    h: (swapped ? img.width : img.height) * t.scale,
  }
}

/** The square must stay covered — no empty gutters, whatever the user drags. */
export function clampOffsets(img: ImageSize, t: Transform): Transform {
  const { w, h } = displayedSize(img, t)
  const maxX = Math.max(0, (w - VIEWPORT_PX) / 2)
  const maxY = Math.max(0, (h - VIEWPORT_PX) / 2)
  return {
    ...t,
    offsetX: Math.min(maxX, Math.max(-maxX, t.offsetX)),
    offsetY: Math.min(maxY, Math.max(-maxY, t.offsetY)),
  }
}

/**
 * Smallest scale that still covers the square, for the current rotation.
 *
 * ⚠ IT DIVIDES BY THE SHORTER EDGE, WHICH IS COVER, NOT CONTAIN. Using the longer edge
 * fits the whole photo into the circle and leaves empty wedges at the sides — which looks
 * like a broken avatar rather than a deliberate framing choice.
 */
export function coverScale(img: ImageSize, rotation: Transform["rotation"]): number {
  const swapped = rotation === 90 || rotation === 270
  const w = swapped ? img.height : img.width
  const h = swapped ? img.width : img.height
  return VIEWPORT_PX / Math.min(w, h)
}

/** Exported so a test can assert against the same square the component renders. */
export const AVATAR_VIEWPORT_PX = VIEWPORT_PX
export const AVATAR_OUTPUT_PX = OUTPUT_PX

export interface AvatarCropDialogProps {
  file: File | null
  open: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: (cropped: File) => void
}

export function AvatarCropDialog({ file, open, busy, onCancel, onConfirm }: AvatarCropDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const transformRef = useRef<Transform>({ scale: 1, offsetX: 0, offsetY: 0, rotation: 0 })

  /** Live pointers, so one finger pans and two pinch without a gesture library. */
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const bmp = bitmapRef.current
    if (!canvas || !bmp) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    paint(ctx, canvas.width, bmp, transformRef.current)
  }, [])

  const applyZoom = useCallback(
    (nextZoom: number) => {
      const bmp = bitmapRef.current
      if (!bmp) return
      const clamped = Math.min(MAX_ZOOM, Math.max(1, nextZoom))
      const base = coverScale(bmp, transformRef.current.rotation)
      transformRef.current = clampOffsets(bmp, {
        ...transformRef.current,
        scale: base * clamped,
      })
      setZoom(clamped)
      redraw()
    },
    [redraw],
  )

  // Decode once per file. Everything else is transform maths on the same bitmap.
  useEffect(() => {
    if (!open || !file) return
    let cancelled = false
    setReady(false)
    setError(null)

    void (async () => {
      try {
        let bmp: ImageBitmap
        try {
          bmp = await createImageBitmap(file, { imageOrientation: "from-image" })
        } catch {
          // Older engines reject the option rather than ignoring it.
          bmp = await createImageBitmap(file)
        }
        if (cancelled) {
          bmp.close()
          return
        }
        bitmapRef.current?.close()
        bitmapRef.current = bmp
        transformRef.current = {
          scale: coverScale(bmp, 0),
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        }
        setZoom(1)
        setReady(true)
        redraw()
      } catch {
        if (!cancelled) setError("That image could not be opened. Try a different one.")
      }
    })()

    return () => {
      cancelled = true
    }
  }, [file, open, redraw])

  // Release the decoded bitmap when the dialog goes away, not on every re-render.
  useEffect(() => {
    if (open) return
    bitmapRef.current?.close()
    bitmapRef.current = null
    setReady(false)
  }, [open])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pointers = pointersRef.current
    const bmp = bitmapRef.current
    if (!ready || !bmp || !pointers.has(e.pointerId)) return

    const previous = pointers.get(e.pointerId)!
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.size >= 2) {
      const [a, b] = Array.from(pointers.values())
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (!pinchRef.current) {
        pinchRef.current = { distance, scale: zoom }
        return
      }
      if (pinchRef.current.distance > 0) {
        applyZoom(pinchRef.current.scale * (distance / pinchRef.current.distance))
      }
      return
    }

    pinchRef.current = null
    transformRef.current = clampOffsets(bmp, {
      ...transformRef.current,
      offsetX: transformRef.current.offsetX + (e.clientX - previous.x),
      offsetY: transformRef.current.offsetY + (e.clientY - previous.y),
    })
    redraw()
  }

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
  }

  const rotate = () => {
    const bmp = bitmapRef.current
    if (!bmp) return
    const rotation = (((transformRef.current.rotation + 90) % 360) as Transform["rotation"])
    // Re-derive the base scale: a quarter turn swaps which edge has to cover the square.
    transformRef.current = clampOffsets(bmp, {
      ...transformRef.current,
      rotation,
      scale: coverScale(bmp, rotation) * zoom,
    })
    redraw()
  }

  const confirm = async () => {
    const bmp = bitmapRef.current
    if (!bmp || !file) return
    const out = document.createElement("canvas")
    out.width = OUTPUT_PX
    out.height = OUTPUT_PX
    const ctx = out.getContext("2d")
    if (!ctx) {
      setError("Could not prepare the image on this device.")
      return
    }
    // Same paint(), larger size — the export cannot drift from the preview.
    paint(ctx, OUTPUT_PX, bmp, transformRef.current)

    const type = outputTypeFor(file.type)
    const blob: Blob | null = await new Promise((resolve) =>
      out.toBlob((b) => resolve(b), type, type === "image/jpeg" ? JPEG_QUALITY : undefined),
    )
    if (!blob || blob.size === 0) {
      setError("Could not save the crop on this device.")
      return
    }
    const base = file.name.replace(/\.[^.]+$/, "") || "avatar"
    const ext = type === "image/png" ? "png" : "jpg"
    onConfirm(new File([blob], `${base}-avatar.${ext}`, { type, lastModified: Date.now() }))
  }

  return (
    <AppModal
      open={open}
      onClose={onCancel}
      title="Position your picture"
      description="Drag to move, pinch or use the slider to zoom."
      size="sm"
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!ready || busy}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--accent, #06b6d4)", color: "#04121a" }}
          >
            {busy ? "Uploading…" : "Save picture"}
          </button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="relative overflow-hidden rounded-full"
          style={{ width: VIEWPORT_PX, height: VIEWPORT_PX, background: "var(--panel2, #0b1220)" }}
        >
          <canvas
            ref={canvasRef}
            width={VIEWPORT_PX}
            height={VIEWPORT_PX}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            // Without this the browser scrolls the page instead of giving us the drag.
            style={{ touchAction: "none", cursor: ready ? "grab" : "default" }}
            aria-label="Profile picture crop area"
          />
        </div>

        <div className="flex w-full items-center gap-3" style={{ maxWidth: VIEWPORT_PX }}>
          <ZoomIn className="h-4 w-4 shrink-0" style={{ color: "var(--muted)" }} aria-hidden />
          {/* The slider is not decoration: pinch is unavailable with a mouse or a keyboard. */}
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={!ready}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="w-full"
            aria-label="Zoom"
          />
          <button
            type="button"
            onClick={rotate}
            disabled={!ready}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
            aria-label="Rotate 90 degrees"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Rotate
          </button>
        </div>

        {error && (
          <p className="text-xs" style={{ color: "var(--accent-red-strong, #f87171)" }}>
            {error}
          </p>
        )}
      </div>
    </AppModal>
  )
}

export default AvatarCropDialog

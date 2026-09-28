'use client'

import { useRef } from 'react'
import { X } from 'lucide-react'
import { useOverlayContainment } from '../useOverlayContainment'

/**
 * A chat image at full size, fitted — never cropped.
 *
 * ⚠ RENDERED IN PLACE, NOT PORTALED TO <body>. The drawer's overlay containment
 * marks every sibling of the drawer inert while it is open; a viewer portaled
 * outside it would be inert too, and unclickable. Inside the drawer, `position:
 * fixed` resolves against the drawer (it is a size container), so the viewer
 * fills the panel — which on a phone is the screen.
 *
 * ⚠ IT JOINS THE OVERLAY STACK. The drawer answers Escape from a capture-phase
 * listener, so a local key handler would lose the race and one Escape would shut
 * the whole drawer. As the topmost overlay, the viewer answers first and alone.
 */
export function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useOverlayContainment({ active: true, containerRef: rootRef, initialFocusRef: closeRef, onClose })

  return (
    <div
      ref={rootRef}
      className="af-cm-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Image"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="af-cm-viewer-img" src={src} alt="" />
      <div className="af-cm-viewer-bar">
        <a className="af-cm-viewer-link" href={src} target="_blank" rel="noopener noreferrer">
          Open original
        </a>
        <button ref={closeRef} type="button" className="af-cm-viewer-x" onClick={onClose} aria-label="Close image">
          <X size={18} aria-hidden />
        </button>
      </div>
    </div>
  )
}

export default ImageViewer

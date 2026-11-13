'use client'

import React from 'react'
import { X } from 'lucide-react'

interface PublishConfirmationModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
}

/**
 * Publish confirmation — mandatory UI. User must confirm before publish.
 */
export default function PublishConfirmationModal({
  open,
  onClose,
  onConfirm,
  title = 'Publish content?',
  message = 'This will make the content available. You can undo from the content dashboard.',
  confirmLabel = 'Publish',
  cancelLabel = 'Cancel',
  loading = false,
}: PublishConfirmationModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-modal-title"
      data-testid="media-publish-confirmation-modal"
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-white/10 bg-black/90 p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 id="publish-modal-title" className="text-lg font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Close"
            data-testid="media-publish-modal-close-button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-white/70 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
            data-testid="media-publish-modal-cancel-button"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="rounded-lg bg-cyan-500/20 border border-cyan-400/30 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
            data-testid="media-publish-modal-confirm-button"
          >
            {loading ? 'Publishing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

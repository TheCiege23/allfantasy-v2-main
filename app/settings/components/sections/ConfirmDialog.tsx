"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

/**
 * An in-app confirmation for a consequential settings action (disconnecting an account).
 *
 * These used to be `window.confirm()`: unstyled system chrome over the settings page, unable to say
 * more than a line, and SUPPRESSED by some embedded webviews and in-app browsers — where it returns
 * false (the action can never happen) or never shows. This dialog behaves like the delete-account
 * one: focus lands on Cancel (the safe choice), Tab stays inside, Escape cancels, the page does not
 * scroll behind it, and focus returns to the button that opened it.
 *
 * Use through `useConfirm()`, which keeps the call sites as simple as `confirm()` was:
 *   if (!(await askConfirm({ title, body, confirmLabel: "Disconnect" }))) return
 */

export type ConfirmRequest = {
  title: string
  body?: ReactNode
  confirmLabel: string
  /**
   * The caller's translated "Cancel". Passed in rather than read from useLanguage here, because
   * `components/core-app/import/ConnectedPlatforms` opens this dialog outside Settings too.
   */
  cancelLabel?: string
  /** Defaults to "danger": every current use removes a connection. */
  tone?: "danger" | "default"
}

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void }

export function useConfirm(): [(request: ConfirmRequest) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const askConfirm = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        // A second ask while one is open answers the first "no" rather than leaving it hanging.
        pendingRef.current?.resolve(false)
        const next = { ...request, resolve }
        pendingRef.current = next
        setPending(next)
      }),
    [],
  )

  const settle = useCallback((ok: boolean) => {
    const current = pendingRef.current
    pendingRef.current = null
    setPending(null)
    current?.resolve(ok)
  }, [])

  // Unmounting with a question open answers it "no", so no caller awaits forever.
  useEffect(() => () => pendingRef.current?.resolve(false), [])

  const dialog = pending ? (
    <ConfirmDialog
      request={pending}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null

  return [askConfirm, dialog]
}

function ConfirmDialog({
  request,
  onConfirm,
  onCancel,
}: {
  request: ConfirmRequest
  onConfirm: () => void
  onCancel: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key !== "Tab") return
      const panel = panelRef.current
      if (!panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"))
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
      opener?.focus?.({ preventScroll: true })
    }
    // The dialog mounts once per question; its handlers do not change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const danger = (request.tone ?? "danger") === "danger"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="settings-confirm-title"
      aria-describedby={request.body ? "settings-confirm-body" : undefined}
      data-testid="settings-confirm-dialog"
      onMouseDown={(e) => {
        // A tap on the backdrop cancels; a tap inside the panel does not.
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-sm rounded-2xl border p-5 shadow-xl"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <h3 id="settings-confirm-title" className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {request.title}
        </h3>
        {request.body ? (
          <div id="settings-confirm-body" className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            {request.body}
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="ns-btn-ghost"
            data-testid="settings-confirm-cancel"
          >
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={danger ? "ns-btn-ghost" : "ns-btn-primary"}
            style={
              danger
                ? {
                    borderColor: "color-mix(in srgb, var(--accent-red) 55%, var(--border))",
                    color: "var(--accent-red-strong)",
                  }
                : undefined
            }
            data-testid="settings-confirm-accept"
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import clsx from 'clsx'

export type ZombieToast = {
  id: string
  kind: string
  title: string
  subtitle?: string
  duration?: number
}

const TOAST_ICONS: Record<string, string> = {
  infection: '🧟',
  revival: '⚡',
  bashing: '🔥',
  mauling: '💀',
  serum: '🧪',
  weapon: '⚔️',
  ambush: '🎭',
  bomb: '💣',
  whisperer: '🎭',
  horde: '🧟',
  update: '📝',
  danger: '⚠️',
}

const TOAST_BORDERS: Record<string, string> = {
  infection: 'border-l-[var(--zombie-purple)]',
  revival: 'border-l-[var(--zombie-gold)]',
  bashing: 'border-l-orange-500',
  mauling: 'border-l-[var(--zombie-red)]',
  serum: 'border-l-teal-500',
  weapon: 'border-l-white/30',
  ambush: 'border-l-[var(--zombie-crimson)]',
  bomb: 'border-l-amber-500',
  whisperer: 'border-l-[var(--zombie-crimson)]',
  horde: 'border-l-[var(--zombie-purple)]',
  update: 'border-l-sky-500',
  danger: 'border-l-red-500',
}

const TOAST_ANIMS: Record<string, string> = {
  infection: 'zombie-turn-anim',
  revival: 'revival-anim',
  mauling: 'mauling-anim',
  bomb: 'bomb-anim',
  weapon: 'weapon-pop-anim',
  serum: 'serum-anim',
  ambush: 'ambush-anim',
}

/**
 * Global toast container for zombie event notifications.
 * Place once in the zombie layout. Push toasts via the exported hook.
 */
export function ZombieToastContainer() {
  const [toasts, setToasts] = useState<ZombieToast[]>([])

  // Listen for custom events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ZombieToast>).detail
      if (!detail?.id) return
      setToasts((prev) => {
        if (prev.some((t) => t.id === detail.id)) return prev
        return [...prev, detail].slice(-5)
      })
    }
    window.addEventListener('zombie-toast', handler)
    return () => window.removeEventListener('zombie-toast', handler)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <div
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-50 flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2 md:bottom-4"
      aria-live="polite"
      role="log"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: ZombieToast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const dur = toast.duration ?? 5000
    const t = setTimeout(() => onDismiss(toast.id), dur)
    return () => clearTimeout(t)
  }, [toast, onDismiss])

  const icon = TOAST_ICONS[toast.kind] ?? '📣'
  const border = TOAST_BORDERS[toast.kind] ?? 'border-l-white/15'
  const anim = TOAST_ANIMS[toast.kind] ?? ''

  return (
    <div
      className={clsx(
        'rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)]/95 backdrop-blur-md py-3 pl-4 pr-3 border-l-4 shadow-lg',
        'animate-in slide-in-from-right-full fade-in duration-300',
        border,
        anim,
      )}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-lg">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold leading-tight text-[var(--zombie-text-full)]">
            {toast.title}
          </p>
          {toast.subtitle && (
            <p className="mt-0.5 text-[11px] text-[var(--zombie-text-mid)] line-clamp-2">
              {toast.subtitle}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="shrink-0 text-[var(--zombie-text-dim)] hover:text-white"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

/**
 * Dispatch a toast notification from anywhere in the zombie UI.
 */
export function pushZombieToast(toast: ZombieToast): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('zombie-toast', { detail: toast }),
  )
}

/**
 * Convert animation event types to toast kinds.
 */
export function animationToToast(
  animationType: string,
  metadata: Record<string, unknown>,
  week?: number,
): ZombieToast | null {
  const id = `toast-${animationType}-${Date.now()}`
  const victim = typeof metadata.victimName === 'string' ? metadata.victimName : null
  const actor = typeof metadata.infectorName === 'string' ? metadata.infectorName : null

  switch (animationType) {
    case 'zombie_turn':
      return {
        id,
        kind: 'infection',
        title: victim ? `${victim} has been turned.` : 'The infection spreads.',
        subtitle: actor ? `Infected by ${actor}` : undefined,
      }
    case 'player_revived':
      return {
        id,
        kind: 'revival',
        title: victim ? `${victim} returned from the dead!` : 'A player has been revived!',
      }
    case 'mauling':
      return {
        id,
        kind: 'mauling',
        title: 'A mauling shook the island.',
        subtitle: typeof metadata.margin === 'number' ? `Margin: ${metadata.margin.toFixed(1)} pts` : undefined,
      }
    case 'bashing':
      return {
        id,
        kind: 'bashing',
        title: 'A bashing dominated the scoreboard.',
      }
    case 'bomb_detonated':
      return {
        id,
        kind: 'bomb',
        title: 'A bomb has detonated!',
        duration: 8000,
      }
    case 'serum_used':
      return {
        id,
        kind: 'serum',
        title: victim ? `${victim} used a serum.` : 'A serum was consumed.',
      }
    case 'ambush_triggered':
      return {
        id,
        kind: 'ambush',
        title: 'The Whisperer stirred. Something changed.',
      }
    case 'whisperer_replaced':
      return {
        id,
        kind: 'whisperer',
        title: 'The old Whisperer has fallen.',
        subtitle: 'A new shadow rises.',
        duration: 7000,
      }
    case 'horde_grows':
      return {
        id,
        kind: 'horde',
        title: `The Horde grows.${typeof metadata.hordeSize === 'number' ? ` ${metadata.hordeSize} strong.` : ''}`,
      }
    default:
      return null
  }
}

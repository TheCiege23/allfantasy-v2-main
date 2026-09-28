'use client'

import { useEffect, useRef } from 'react'
import { X, RefreshCw, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import type { PlanRefusal } from '@/lib/monetization/planRefusal'
import { PlanRefusalNotice } from '@/components/monetization/PlanRefusalNotice'

export type AIToolModalShellProps = {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  accentColor?: string
  icon?: React.ReactNode
  /** Optional status badge in the header row (e.g. FantasyCalc live). */
  headerBadge?: React.ReactNode
  /** Rolling Insights / News / AI pills — set false for compact tool headers. */
  showApiPills?: boolean
  /** Wider modal for dense consoles (e.g. Trade Value). */
  wide?: boolean
  loading?: boolean
  error?: string | null
  /**
   * A paywall answer from the server (lib/monetization/planRefusal.ts). Shown INSTEAD of `error`,
   * with the button that fixes it — never the bare words "Premium feature".
   */
  refusal?: PlanRefusal | null
  empty?: boolean
  emptyMessage?: string
  onRefresh?: () => void
  refreshing?: boolean
  chimmyPrompt?: string
  chimmyContext?: Record<string, unknown>
  actions?: React.ReactNode
  children: React.ReactNode
}

export function AIToolModalShell({
  open,
  onClose,
  title,
  subtitle,
  accentColor = 'cyan',
  icon,
  headerBadge,
  showApiPills = true,
  wide = false,
  loading = false,
  error = null,
  refusal = null,
  empty = false,
  emptyMessage = 'No data available yet.',
  onRefresh,
  refreshing = false,
  chimmyPrompt,
  chimmyContext,
  actions,
  children,
}: AIToolModalShellProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const accentMap: Record<
    string,
    {
      circle: string
      border: string
      text: string
      glow: string
      softBg: string
    }
  > = {
    cyan: {
      circle: 'border-[#00d4aa] bg-[rgba(0,212,170,0.12)] text-[#00d4aa]',
      border: 'border-[#2e3347]',
      text: 'text-[#00d4aa]',
      glow: 'shadow-[0_0_48px_rgba(0,212,170,0.07)]',
      softBg: 'bg-[rgba(0,212,170,0.06)]',
    },
    purple: {
      circle: 'border-[#a78bfa] bg-[rgba(167,139,250,0.12)] text-[#a78bfa]',
      border: 'border-[#2e3347]',
      text: 'text-[#a78bfa]',
      glow: 'shadow-[0_0_48px_rgba(167,139,250,0.07)]',
      softBg: 'bg-[rgba(167,139,250,0.06)]',
    },
    amber: {
      circle: 'border-[#f5a623] bg-[rgba(245,166,35,0.12)] text-[#f5a623]',
      border: 'border-[#2e3347]',
      text: 'text-[#f5a623]',
      glow: 'shadow-[0_0_48px_rgba(245,166,35,0.07)]',
      softBg: 'bg-[rgba(245,166,35,0.06)]',
    },
    emerald: {
      circle: 'border-emerald-400 bg-emerald-500/15 text-emerald-300',
      border: 'border-[#2e3347]',
      text: 'text-emerald-300',
      glow: 'shadow-[0_0_48px_rgba(16,185,129,0.07)]',
      softBg: 'bg-emerald-500/[0.06]',
    },
    red: {
      circle: 'border-[#f06060] bg-[rgba(240,96,96,0.12)] text-[#f06060]',
      border: 'border-[#2e3347]',
      text: 'text-[#f06060]',
      glow: 'shadow-[0_0_48px_rgba(240,96,96,0.07)]',
      softBg: 'bg-[rgba(240,96,96,0.06)]',
    },
    rose: {
      circle: 'border-rose-400 bg-rose-500/15 text-rose-300',
      border: 'border-[#2e3347]',
      text: 'text-rose-300',
      glow: 'shadow-[0_0_48px_rgba(244,63,94,0.07)]',
      softBg: 'bg-rose-500/[0.06]',
    },
    violet: {
      circle: 'border-violet-400 bg-violet-500/15 text-violet-300',
      border: 'border-[#2e3347]',
      text: 'text-violet-300',
      glow: 'shadow-[0_0_48px_rgba(139,92,246,0.07)]',
      softBg: 'bg-violet-500/[0.06]',
    },
    sky: {
      circle: 'border-sky-400 bg-sky-500/15 text-sky-300',
      border: 'border-[#2e3347]',
      text: 'text-sky-300',
      glow: 'shadow-[0_0_48px_rgba(14,165,233,0.07)]',
      softBg: 'bg-sky-500/[0.06]',
    },
  }

  const accent = accentMap[accentColor] ?? accentMap.cyan

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />

      <div
        className={`ai-tools-modal-shell ai-tools-modal-animate relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[10px] border border-[#2e3347] bg-[#0b0e14] sm:rounded-[10px] ${wide ? 'sm:max-w-2xl lg:max-w-3xl' : 'sm:max-w-xl'} ${accent.glow}`}
      >
        {/* Header — circular tool glyph + title stack + refresh/close */}
        <div className={`shrink-0 border-b px-4 pb-4 pt-4 sm:px-5 sm:pt-5 ${accent.border}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              {icon && (
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${accent.circle}`}
                >
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="text-[16px] font-bold tracking-tight text-[#e8eaf6]">{title}</h2>
                {subtitle && <p className="mt-0.5 text-[11px] text-[#5c6480]">{subtitle}</p>}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {headerBadge}
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing}
                  className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#3d4460] bg-[#242838] text-[#9ba3bf] transition hover:border-[#5c6480] hover:text-[#e8eaf6]"
                  aria-label="Refresh"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#3d4460] bg-[#242838] text-[#9ba3bf] transition hover:border-[#5c6480] hover:text-[#e8eaf6]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {showApiPills ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="at-api-pill at-api-pill--live text-[9px] font-semibold uppercase tracking-wide">
                Rolling Insights
              </span>
              <span className="at-api-pill text-[9px] font-semibold uppercase tracking-wide">News API</span>
              <span className="at-api-pill text-[9px] font-semibold uppercase tracking-wide">AI Engine</span>
            </div>
          ) : null}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-[#0b0e14] px-4 py-4 sm:px-5 [scrollbar-width:thin] [scrollbar-color:#3d4460_transparent]">
          {loading ? (
            <div className="flex flex-col items-center py-12 text-center">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full border border-[#2e3347] ${accent.softBg}`}
              >
                <Loader2 className={`h-6 w-6 animate-spin ${accent.text}`} />
              </div>
              <p className="mt-4 text-[13px] text-[#5c6480]">Analyzing...</p>
            </div>
          ) : refusal ? (
            <PlanRefusalNotice refusal={refusal} variant="block" />
          ) : error ? (
            <div className="flex flex-col items-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#f06060]/30 bg-[rgba(240,96,96,0.08)]">
                <X className="h-6 w-6 text-[#f06060]" />
              </div>
              <p className="mt-4 text-[13px] text-[#f06060]/90">{error}</p>
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  className={`mt-3 text-[12px] font-semibold ${accent.text} hover:brightness-110`}
                >
                  Try again
                </button>
              )}
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center py-12 text-center">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full border border-[#2e3347] ${accent.softBg}`}
              >
                {icon}
              </div>
              <p className="mt-4 text-[13px] text-[#5c6480]">{emptyMessage}</p>
            </div>
          ) : (
            children
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-[#2e3347] bg-[#0b0e14] px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
            {chimmyPrompt && (
              <Link
                href={getChimmyChatHrefWithPrompt(chimmyPrompt, chimmyContext ?? {})}
                className="at-btn-primary inline-flex items-center gap-1.5 text-[12px] font-semibold no-underline"
              >
                Ask Chimmy
              </Link>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}

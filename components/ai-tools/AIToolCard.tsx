'use client'

import type { AIToolCardConfig, AIToolAccent, FreshnessStatus } from './types'

// Re-export so existing grid imports `{ AIToolCardConfig }` from this file
// keep working without a churn-y import-path change.
export type { AIToolCardConfig } from './types'

// ── Accent palette (tactical room — bordered tiles, muted insight slab) ──
type AccentStyle = {
  border: string
  hoverBorder: string
  iconBox: string
  iconGlow: string
  ring: string
  dot: string
  statusMuted: string
  insightBox: string
  insightText: string
  footerPill: string
  footerText: string
}

const ACCENT_STYLES: Record<AIToolAccent, AccentStyle> = {
  cyan: {
    border: 'border-[#2e3347]',
    hoverBorder: 'group-hover:border-[#00d4aa]/35',
    iconBox: 'border border-[#2e3347] bg-[rgba(0,212,170,0.12)] text-[#00d4aa]',
    iconGlow: 'group-hover:shadow-[0_0_20px_-4px_rgba(0,212,170,0.45)]',
    ring: 'group-hover:ring-[#00d4aa]/20',
    dot: 'bg-[#00d4aa]',
    statusMuted: 'text-[#5c6480]',
    insightBox: 'border border-[#2e3347] bg-[#242838]',
    insightText: 'text-[#9ba3bf]',
    footerPill: 'bg-[rgba(0,212,170,0.12)] border-[#00d4aa]/25',
    footerText: 'text-[#00d4aa]/90',
  },
  purple: {
    border: 'border-[#2e3347]',
    hoverBorder: 'group-hover:border-[#a78bfa]/40',
    iconBox: 'border border-[#2e3347] bg-[rgba(167,139,250,0.12)] text-[#a78bfa]',
    iconGlow: 'group-hover:shadow-[0_0_20px_-4px_rgba(167,139,250,0.45)]',
    ring: 'group-hover:ring-[#a78bfa]/20',
    dot: 'bg-[#a78bfa]',
    statusMuted: 'text-[#5c6480]',
    insightBox: 'border border-[#2e3347] bg-[#242838]',
    insightText: 'text-[#9ba3bf]',
    footerPill: 'bg-[rgba(167,139,250,0.12)] border-[#a78bfa]/25',
    footerText: 'text-[#a78bfa]/90',
  },
  amber: {
    border: 'border-[#2e3347]',
    hoverBorder: 'group-hover:border-[#f5a623]/40',
    iconBox: 'border border-[#2e3347] bg-[rgba(245,166,35,0.12)] text-[#f5a623]',
    iconGlow: 'group-hover:shadow-[0_0_20px_-4px_rgba(245,166,35,0.45)]',
    ring: 'group-hover:ring-[#f5a623]/20',
    dot: 'bg-[#f5a623]',
    statusMuted: 'text-[#5c6480]',
    insightBox: 'border border-[#2e3347] bg-[#242838]',
    insightText: 'text-[#9ba3bf]',
    footerPill: 'bg-[rgba(245,166,35,0.12)] border-[#f5a623]/25',
    footerText: 'text-[#f5a623]/90',
  },
  emerald: {
    border: 'border-[#2e3347]',
    hoverBorder: 'group-hover:border-[#00d4aa]/35',
    iconBox: 'border border-[#2e3347] bg-[rgba(0,212,170,0.1)] text-[#34d399]',
    iconGlow: 'group-hover:shadow-[0_0_20px_-4px_rgba(52,211,153,0.4)]',
    ring: 'group-hover:ring-emerald-400/20',
    dot: 'bg-emerald-400',
    statusMuted: 'text-[#5c6480]',
    insightBox: 'border border-[#2e3347] bg-[#242838]',
    insightText: 'text-[#9ba3bf]',
    footerPill: 'bg-[rgba(52,211,153,0.12)] border-emerald-400/25',
    footerText: 'text-emerald-300/90',
  },
  red: {
    border: 'border-[#2e3347]',
    hoverBorder: 'group-hover:border-[#f06060]/40',
    iconBox: 'border border-[#2e3347] bg-[rgba(240,96,96,0.12)] text-[#f06060]',
    iconGlow: 'group-hover:shadow-[0_0_20px_-4px_rgba(240,96,96,0.4)]',
    ring: 'group-hover:ring-red-400/20',
    dot: 'bg-[#f06060]',
    statusMuted: 'text-[#5c6480]',
    insightBox: 'border border-[#2e3347] bg-[#242838]',
    insightText: 'text-[#9ba3bf]',
    footerPill: 'bg-[rgba(240,96,96,0.12)] border-[#f06060]/25',
    footerText: 'text-[#f88888]/95',
  },
  rose: {
    border: 'border-[#2e3347]',
    hoverBorder: 'group-hover:border-[#fb7185]/40',
    iconBox: 'border border-[#2e3347] bg-[rgba(251,113,133,0.12)] text-[#fb7185]',
    iconGlow: 'group-hover:shadow-[0_0_20px_-4px_rgba(251,113,133,0.4)]',
    ring: 'group-hover:ring-rose-400/20',
    dot: 'bg-rose-400',
    statusMuted: 'text-[#5c6480]',
    insightBox: 'border border-[#2e3347] bg-[#242838]',
    insightText: 'text-[#9ba3bf]',
    footerPill: 'bg-[rgba(251,113,133,0.12)] border-rose-400/25',
    footerText: 'text-rose-300/90',
  },
  violet: {
    border: 'border-[#2e3347]',
    hoverBorder: 'group-hover:border-[#8b5cf6]/40',
    iconBox: 'border border-[#2e3347] bg-[rgba(139,92,246,0.12)] text-[#a78bfa]',
    iconGlow: 'group-hover:shadow-[0_0_20px_-4px_rgba(139,92,246,0.45)]',
    ring: 'group-hover:ring-violet-400/20',
    dot: 'bg-violet-400',
    statusMuted: 'text-[#5c6480]',
    insightBox: 'border border-[#2e3347] bg-[#242838]',
    insightText: 'text-[#9ba3bf]',
    footerPill: 'bg-[rgba(139,92,246,0.12)] border-violet-400/25',
    footerText: 'text-violet-300/90',
  },
  sky: {
    border: 'border-[#2e3347]',
    hoverBorder: 'group-hover:border-[#38bdf8]/40',
    iconBox: 'border border-[#2e3347] bg-[rgba(56,189,248,0.12)] text-[#38bdf8]',
    iconGlow: 'group-hover:shadow-[0_0_20px_-4px_rgba(56,189,248,0.4)]',
    ring: 'group-hover:ring-sky-400/20',
    dot: 'bg-sky-400',
    statusMuted: 'text-[#5c6480]',
    insightBox: 'border border-[#2e3347] bg-[#242838]',
    insightText: 'text-[#9ba3bf]',
    footerPill: 'bg-[rgba(56,189,248,0.12)] border-sky-400/25',
    footerText: 'text-sky-300/90',
  },
}

function statusLabel(config: AIToolCardConfig): string {
  if (config.status === 'new') return 'New'
  if (config.status === 'loading') return 'Syncing'
  if (config.status === 'preview') return 'Preview'
  if (config.status === 'missing') return 'Missing data'
  return 'Ready'
}

function statusDotAnimation(status: FreshnessStatus | undefined): string {
  switch (status) {
    case 'live':
      return 'animate-pulse opacity-90'
    case 'recent':
      return 'opacity-80'
    case 'stale':
      return 'opacity-40'
    default:
      return 'opacity-60'
  }
}

export function AIToolCard({
  config,
  onClick,
}: {
  config: AIToolCardConfig
  onClick: () => void
}) {
  const accent = ACCENT_STYLES[config.accent] ?? ACCENT_STYLES.cyan
  const label = statusLabel(config)
  const freshness = config.freshness
  const hasInsight = Boolean(config.insight && config.insight.trim().length > 0)

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'group relative flex w-full flex-col rounded-[10px] border p-3.5 text-left',
        'bg-[#1a1d27]',
        accent.border,
        'transition-all duration-200 ease-out',
        accent.hoverBorder,
        accent.iconGlow,
        'hover:-translate-y-px hover:bg-[#1e2230]',
        'focus-visible:outline-none focus-visible:ring-2',
        accent.ring,
        'active:scale-[0.99]',
      ].join(' ')}
      data-testid={`ai-tool-card-${config.id}`}
    >
      {/* Top row: icon tile + readiness (● READY / NEW) */}
      <div className="flex items-start justify-between gap-2">
        <div
          className={[
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]',
            accent.iconBox,
            'transition-all duration-200',
            'group-hover:scale-[1.04]',
          ].join(' ')}
        >
          {config.icon}
        </div>
        <div className="flex min-w-0 flex-col items-end gap-0.5 pt-0.5">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${accent.dot} ${statusDotAnimation(freshness?.status)}`}
            />
            <span className={`text-[11px] font-bold uppercase tracking-[0.14em] ${accent.statusMuted}`}>
              {label}
            </span>
          </span>
        </div>
      </div>

      <div className="mt-3 flex-1">
        <h3 className="text-[14px] font-bold leading-tight tracking-tight text-[#e8eaf6]">
          {config.title}
        </h3>
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-[#5c6480]">{config.subtitle}</p>
      </div>

      {hasInsight ? (
        <div
          className={`mt-3 rounded-[8px] px-2.5 py-2 text-[11px] font-medium leading-snug ${accent.insightBox} ${accent.insightText} line-clamp-2`}
        >
          {config.insight}
        </div>
      ) : null}

      {freshness && freshness.status !== 'idle' ? (
        <div
          className={`mt-2.5 inline-flex max-w-full items-center gap-1.5 self-start rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${accent.footerPill} ${accent.footerText}`}
        >
          <span
            aria-hidden
            className={`inline-block h-1 w-1 shrink-0 rounded-full ${accent.dot} ${
              freshness.status === 'live' ? 'animate-pulse' : ''
            }`}
          />
          {freshness.label}
        </div>
      ) : null}
    </button>
  )
}

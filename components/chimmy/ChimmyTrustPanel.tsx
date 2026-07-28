/**
 * ChimmyTrustPanel — displays confidence level, rationale, contributing signals,
 * missing signals, freshness, and source links for a Chimmy assistant response.
 *
 * Written with React.createElement (no JSX) so Vitest can import it directly
 * without a React JSX transform plugin.
 */
import React from 'react'
import type { ChimmyConfidenceBlock } from '@/lib/chimmy-chat/response-contract'
import type { ChimmyMessageMeta } from '@/lib/chimmy-chat/types'
import { isRenderableChimmyContentHref } from '@/lib/chimmy-chat/safeChimmyLinks'

export type ChimmyTrustPanelProps = {
  confidencePct?: number | null
  confidenceBlock?: ChimmyConfidenceBlock | null
  dataSources?: string[]
  syncFreshness?: ChimmyMessageMeta['syncFreshness']
  sourceLinks?: { label: string; href: string }[]
}

const LEVEL_CLASSES: Record<string, string> = {
  high: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
  medium: 'text-yellow-300 bg-yellow-500/15 border-yellow-500/30',
  low: 'text-red-400 bg-red-500/15 border-red-500/30',
}

const FRESHNESS_CLASSES: Record<string, string> = {
  fresh: 'text-emerald-300',
  partial: 'text-yellow-300',
  stale: 'text-red-400',
  unknown: 'text-white/40',
}

function formatIsoTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return null
  }
}

export default function ChimmyTrustPanel({
  confidencePct,
  confidenceBlock,
  dataSources,
  syncFreshness,
  sourceLinks,
}: ChimmyTrustPanelProps) {
  const [expanded, setExpanded] = React.useState(false)

  const level = confidenceBlock?.level ?? null
  const pct = typeof confidencePct === 'number' ? confidencePct : null
  const hasAnyData =
    level != null ||
    pct != null ||
    (dataSources?.length ?? 0) > 0 ||
    (sourceLinks?.length ?? 0) > 0

  if (!hasAnyData) return null

  const levelLabel = level ? level.charAt(0).toUpperCase() + level.slice(1) : null
  const levelClasses = level ? (LEVEL_CLASSES[level] ?? LEVEL_CLASSES.medium) : null

  const basedOn = confidenceBlock?.basedOn ?? []
  const missing = confidenceBlock?.missing ?? []
  const rationale = confidenceBlock?.rationale ?? null
  const freshness = confidenceBlock?.freshness ?? null
  const leagueContext = confidenceBlock?.leagueContext ?? null
  const freshnessClass = freshness ? (FRESHNESS_CLASSES[freshness] ?? FRESHNESS_CLASSES.unknown) : null

  const syncedAt = syncFreshness?.sportsDigest?.overallLastSyncedAt
  const syncedLabel = formatIsoTime(syncedAt)
  const topSources = Object.entries(syncFreshness?.sportsDigest?.perSource ?? {})
    .filter(([, v]) => v != null)
    .slice(0, 3)

  // ── collapsed bar ───────────────────────────────────────────────────────────
  const collapsedContent = React.createElement(
    'div',
    {
      'data-testid': 'chimmy-trust-panel',
      className: 'mt-3 pt-3 border-t border-white/10',
    },
    React.createElement(
      'div',
      { className: 'flex flex-wrap items-center gap-2' },
      // level badge
      levelLabel && levelClasses
        ? React.createElement(
            'span',
            {
              'data-testid': 'chimmy-trust-panel-badge',
              className: `inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${levelClasses}`,
            },
            levelLabel,
          )
        : null,
      // percentage
      pct != null
        ? React.createElement(
            'span',
            {
              'data-testid': 'chimmy-trust-panel-pct',
              className: 'text-[10px] text-white/50',
            },
            `${pct}%`,
          )
        : null,
      // sources summary (collapsed)
      !expanded && (dataSources?.length ?? 0) > 0
        ? React.createElement(
            'span',
            {
              'data-testid': 'chimmy-trust-panel-sources-summary',
              className: 'text-[10px] text-white/40',
            },
            `Sources: ${(dataSources ?? []).slice(0, 2).join(', ')}`,
          )
        : null,
      // freshness pill (collapsed)
      !expanded && freshness && freshnessClass
        ? React.createElement(
            'span',
            {
              'data-testid': 'chimmy-trust-panel-freshness',
              className: `text-[10px] ${freshnessClass}`,
            },
            freshness.charAt(0).toUpperCase() + freshness.slice(1),
          )
        : null,
      // expand / collapse button
      (rationale || basedOn.length > 0 || missing.length > 0 || syncedLabel)
        ? React.createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'chimmy-trust-panel-expand',
              onClick: () => setExpanded((v) => !v),
              className:
                'ml-auto text-[10px] text-white/40 hover:text-white/70 transition underline-offset-2 hover:underline',
              'aria-expanded': expanded,
              'aria-controls': 'chimmy-trust-panel-details',
            },
            expanded ? 'Hide signals' : 'Why?',
          )
        : null,
    ),
    // ── expanded details ──────────────────────────────────────────────────────
    expanded
      ? React.createElement(
          'div',
          {
            id: 'chimmy-trust-panel-details',
            'data-testid': 'chimmy-trust-panel-details',
            className: 'mt-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 space-y-2',
          },
          // rationale
          rationale
            ? React.createElement(
                'p',
                {
                  'data-testid': 'chimmy-trust-panel-rationale',
                  className: 'text-[11px] text-white/60 leading-relaxed',
                },
                rationale,
              )
            : null,
          // league context row
          leagueContext
            ? React.createElement(
                'div',
                { className: 'flex items-center gap-1.5' },
                React.createElement(
                  'span',
                  { className: 'text-[10px] text-white/35 uppercase tracking-wider' },
                  'League context:',
                ),
                React.createElement(
                  'span',
                  {
                    'data-testid': 'chimmy-trust-panel-league-context',
                    className: `text-[10px] font-medium ${
                      leagueContext === 'available'
                        ? 'text-emerald-300'
                        : leagueContext === 'partial'
                          ? 'text-yellow-300'
                          : 'text-white/40'
                    }`,
                  },
                  leagueContext.charAt(0).toUpperCase() + leagueContext.slice(1),
                ),
              )
            : null,
          // basedOn signals
          basedOn.length > 0
            ? React.createElement(
                'div',
                { 'data-testid': 'chimmy-trust-panel-based-on' },
                React.createElement(
                  'p',
                  { className: 'mb-1 text-[10px] text-white/35 uppercase tracking-wider' },
                  'Contributing signals',
                ),
                React.createElement(
                  'div',
                  { className: 'flex flex-wrap gap-1' },
                  ...basedOn.map((sig, i) =>
                    React.createElement(
                      'span',
                      {
                        key: i,
                        className:
                          'rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300/80',
                      },
                      sig,
                    ),
                  ),
                ),
              )
            : null,
          // missing signals
          missing.length > 0
            ? React.createElement(
                'div',
                { 'data-testid': 'chimmy-trust-panel-missing' },
                React.createElement(
                  'p',
                  { className: 'mb-1 text-[10px] text-white/35 uppercase tracking-wider' },
                  'Would improve with',
                ),
                React.createElement(
                  'div',
                  { className: 'flex flex-wrap gap-1' },
                  ...missing.map((sig, i) =>
                    React.createElement(
                      'span',
                      {
                        key: i,
                        className:
                          'rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/50',
                      },
                      sig,
                    ),
                  ),
                ),
              )
            : null,
          // freshness + sync time
          (freshness || syncedLabel)
            ? React.createElement(
                'div',
                { className: 'flex items-center gap-2 flex-wrap' },
                freshness && freshnessClass
                  ? React.createElement(
                      'span',
                      {
                        'data-testid': 'chimmy-trust-panel-freshness',
                        className: `text-[10px] ${freshnessClass}`,
                      },
                      `Data: ${freshness.charAt(0).toUpperCase() + freshness.slice(1)}`,
                    )
                  : null,
                syncedLabel
                  ? React.createElement(
                      'span',
                      { className: 'text-[10px] text-white/35' },
                      `Last sync: ${syncedLabel}${syncFreshness?.referenceTimezone ? ` (${syncFreshness.referenceTimezone})` : ''}`,
                    )
                  : null,
                topSources.length > 0
                  ? React.createElement(
                      'span',
                      { className: 'text-[10px] text-white/30' },
                      topSources
                        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${formatIsoTime(v) ?? 'unknown'}`)
                        .join(' • '),
                    )
                  : null,
              )
            : null,
          // source links
          (sourceLinks?.length ?? 0) > 0
            ? React.createElement(
                'div',
                {
                  'data-testid': 'chimmy-trust-panel-source-links',
                  className: 'flex flex-wrap gap-1.5',
                },
                React.createElement(
                  'span',
                  { className: 'w-full text-[10px] text-white/35 uppercase tracking-wider' },
                  'Sources',
                ),
                // Security: a source-link is only clickable if its href is an internal AllFantasy route
                // (all server-produced attributions are, e.g. /league/{id}). Any external / arbitrary /
                // protocol-relative / malformed href — from a tampered, cached, or malformed payload — is
                // rendered as plain TEXT (name only), never a live external anchor. Real anchors keep
                // rel="noopener noreferrer".
                ...(sourceLinks ?? []).map((link, i) =>
                  isRenderableChimmyContentHref(link.href)
                    ? React.createElement(
                        'a',
                        {
                          key: i,
                          href: link.href,
                          target: '_blank',
                          rel: 'noopener noreferrer',
                          'data-testid': 'chimmy-source-link',
                          className:
                            'rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300/80 hover:text-cyan-200 transition',
                        },
                        link.label,
                      )
                    : React.createElement(
                        'span',
                        {
                          key: i,
                          'data-testid': 'chimmy-source-text',
                          className:
                            'rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/50',
                        },
                        link.label,
                      ),
                ),
              )
            : null,
        )
      : null,
  )

  return collapsedContent
}

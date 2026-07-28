'use client'

/**
 * Compact shared structured renderer for a Chimmy assistant answer — used by the dashboard DRAWER (and any
 * surface wanting a compact structured view). It consumes the SAME validated `ChimmyMessageMeta` contract as
 * the full-page `ChimmyMessageBubble` and reuses the SAME trusted sub-renderers (`ChimmyResponseStructure`
 * for the structured sections, `ChimmyResponseMeta` for trust/freshness/missing-info/actions). It is NOT a
 * third bespoke renderer and never parses actions from display text or renders arbitrary URLs.
 *
 * Compact rule: show the structured sections when present, else the safe raw content; then the meta cluster.
 */
import ChimmyResponseStructure from './ChimmyResponseStructure'
import { ChimmyResponseMeta } from './ChimmyResponseMeta'
import { renderChimmyContentWithLinks } from '@/lib/chimmy-chat/renderChimmyContent'
import type { ChimmyMessageMeta } from '@/lib/chimmy-chat/types'

export function ChimmyStructuredContent({
  content,
  meta,
  showTrustPanel = true,
}: {
  content: string
  meta?: ChimmyMessageMeta | null
  showTrustPanel?: boolean
}) {
  const rs = meta?.responseStructure
  const hasStructuredSections = Boolean(rs?.shortAnswer?.trim())

  return (
    <div className="space-y-1" data-testid="chimmy-structured-content">
      {hasStructuredSections && rs ? (
        <ChimmyResponseStructure
          quickAnswer={rs.shortAnswer}
          whatDataSays={rs.whatDataSays}
          whatItMeans={rs.whatItMeans}
          actionPlan={rs.recommendedAction}
          caveats={rs.caveats}
          sectionTitles={rs.sectionTitles}
          collapsible
          className="mb-1"
        />
      ) : content.trim().length > 0 ? (
        <div className="text-sm leading-relaxed">{renderChimmyContentWithLinks(content)}</div>
      ) : null}

      <ChimmyResponseMeta content={content} meta={meta} mode="compact" showTrustPanel={showTrustPanel} />
    </div>
  )
}

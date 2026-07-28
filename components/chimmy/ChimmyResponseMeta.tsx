'use client'

/**
 * The shared "response meta" cluster rendered under a Chimmy assistant answer on BOTH the full-page bubble
 * and the compact dashboard drawer: honest missing-information, the trust panel (confidence + freshness +
 * data sources + server-validated source links), safe internal suggested actions, and — in full mode — the
 * orchestration deep-link panel. ONE trusted path: every field is server-authored, no action is parsed from
 * display text, and no arbitrary URL is rendered (SuggestedActionRenderer + ChimmyTrustPanel enforce this).
 */
import ChimmyTrustPanel from './ChimmyTrustPanel'
import { ChimmyOrchestrationPanel } from './ChimmyOrchestrationPanel'
import { SuggestedActionRenderer } from '@/lib/chimmy-chat/SuggestedActionRenderer'
import { normalizeMissingInformation } from '@/lib/chimmy-chat/responseEnvelope'
import type { ChimmyMessageMeta } from '@/lib/chimmy-chat/types'

export function ChimmyResponseMeta({
  content,
  meta,
  mode = 'full',
  showTrustPanel = true,
}: {
  content: string
  meta?: ChimmyMessageMeta | null
  /** `full` shows the orchestration panel; `compact` (drawer) omits it to keep density low. */
  mode?: 'full' | 'compact'
  showTrustPanel?: boolean
}) {
  const missing = normalizeMissingInformation(meta?.missingInformation) ?? []

  return (
    <>
      {missing.length > 0 ? (
        <div
          data-testid="chimmy-missing-info"
          className="mt-2 rounded-lg border border-amber-400/25 bg-amber-500/[0.06] px-3 py-2"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/80">What I could not confirm</p>
          <ul className="mt-1 space-y-0.5">
            {missing.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px] leading-snug text-white/70">
                <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-300/60" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {meta && showTrustPanel ? (
        <ChimmyTrustPanel
          confidencePct={meta.confidencePct}
          confidenceBlock={meta.answerContract?.confidence}
          dataSources={meta.dataSources}
          syncFreshness={meta.syncFreshness}
          sourceLinks={meta.sourceLinks}
        />
      ) : null}

      <SuggestedActionRenderer content={content} />

      {mode === 'full' && meta?.orchestration ? (
        <ChimmyOrchestrationPanel orchestration={meta.orchestration} />
      ) : null}
    </>
  )
}

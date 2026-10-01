/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 17, copy-ready content.
 *
 * Deliberately template-based, not LLM-based. `lib/drama-engine/AIDramaNarrativeAdapter.ts`
 * (a real, live LLM-backed narrative generator found in this phase's Part 1
 * inventory) exists and could produce richer prose — but wiring an LLM call
 * into this new coordinator's synchronous read path was judged unsafe to
 * verify within this phase's remaining budget (a real network dependency,
 * cost, and latency this phase cannot physically test end-to-end). This
 * generator instead builds grounded, deterministic copy directly from real
 * `headline`/`summary` fields already computed by the real engines
 * (`DramaEvent`, `RivalryRecord`, power rankings) — always accurate to the
 * source data, never inventing a quote or embellishing beyond it. A future
 * phase can safely layer the real `AIDramaNarrativeAdapter` in as an
 * upgrade path, using this deterministic version as its `aiGenerated: false`
 * fallback (that adapter's own `CommissionerNarrativeOutput.aiGenerated`
 * field already models exactly this fallback pattern).
 *
 * Never automatically publishes — every `CopyReadyContent` entry is
 * preview-only until a future phase wires a real "post" action. Never uses
 * the phrase "AI" in any of the generated text.
 */
import type { CopyReadyContent, PublicationChannel } from '../../types'

const CHANNEL_LIMITS: Partial<Record<PublicationChannel, number>> = {
  social_caption: 280,
  discord: 2000,
  league_chat: 500,
}

function truncate(text: string, limit: number | undefined): string {
  if (!limit || text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

export function buildCopyReadyContent(headline: string, summary: string, channels: PublicationChannel[]): CopyReadyContent[] {
  return channels.map((channel) => {
    const base = channel === 'social_caption' ? headline : `${headline}\n\n${summary}`
    const limit = CHANNEL_LIMITS[channel] ?? null
    const text = truncate(base, limit ?? undefined)
    return {
      channel,
      text,
      characterCount: text.length,
      characterLimit: limit,
      available: true,
    }
  })
}

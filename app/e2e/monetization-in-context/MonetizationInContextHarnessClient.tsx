'use client'

import { useState } from 'react'
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'
import { TokenSpendPreflightModal } from '@/components/monetization/TokenSpendPreflightModal'
import { previewTokenSpend, type TokenSpendClientPreview } from '@/lib/tokens/client-confirm'

export function MonetizationInContextHarnessClient() {
  const [preview, setPreview] = useState<TokenSpendClientPreview | null>(null)
  const [statusMessage, setStatusMessage] = useState('')

  const openPreflight = async () => {
    setStatusMessage('')
    try {
      const nextPreview = await previewTokenSpend('ai_chimmy_chat_message')
      setPreview(nextPreview)
    } catch (error: any) {
      setStatusMessage(error?.message || 'Unable to preview token spend. Showing fallback preflight.')
      setPreview({
        ruleCode: 'ai_chimmy_chat_message',
        featureLabel: 'Chimmy chat message',
        tokenCost: 1,
        currentBalance: 0,
        canSpend: false,
        requiresConfirmation: true,
      })
    }
  }

  return (
    <main className="min-h-screen bg-[#040915] p-4 text-white">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold" data-testid="monetization-in-context-heading">
          Monetization In-Context Harness
        </h1>
        <p className="text-sm text-white/65">
          Verifies entitlement + token visibility, token preflight UX, and upgrade/token CTA wiring.
        </p>

        <InContextMonetizationCard
          title="AI Chat access"
          featureId="ai_chat"
          tokenRuleCodes={['ai_chimmy_chat_message']}
          testIdPrefix="harness-monetization"
        />

        <button
          type="button"
          onClick={() => void openPreflight()}
          className="rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25"
          data-testid="monetization-open-preflight-button"
        >
          Open token preflight
        </button>

        {statusMessage ? (
          <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100" data-testid="monetization-preflight-status">
            {statusMessage}
          </p>
        ) : null}

        <TokenSpendPreflightModal
          open={Boolean(preview)}
          preview={preview}
          title="Confirm Chimmy message token spend"
          confirmLabel="Send message"
          testIdPrefix="harness-token-preflight"
          onClose={() => setPreview(null)}
          onConfirm={() => {
            setPreview(null)
            setStatusMessage('Token spend confirmed.')
          }}
        />
      </div>
    </main>
  )
}


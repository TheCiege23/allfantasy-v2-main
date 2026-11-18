'use client'

import { useState, type ReactNode } from 'react'
import '@/components/core-app/af-core-lock.css'
import { trackLockedFeatureConversionClick } from '@/lib/monetization-analytics'
import { saveTradeReviewDraft, tradeReviewPath, TRADE_REVIEW_TOKEN_RULE, type TradeReviewDraft } from '@/lib/monetization/tradeReviewDraft'

export function TradeReviewLink({
  draft, source, children, storageError, viewerId,
}: {
  draft: TradeReviewDraft
  source: string
  children: ReactNode
  storageError: string
  viewerId?: string | null
}) {
  const [failed, setFailed] = useState(false)

  return (
    <div data-ios-purchase>
      <button
        type="button"
        className="af-core-lock-cta af-core-lock-cta-secondary"
        data-testid="trade-one-off-review"
        onClick={() => {
          const id = saveTradeReviewDraft(draft, null, viewerId)
          if (!id) {
            setFailed(true)
            return
          }
          trackLockedFeatureConversionClick({
            surface: source,
            ctaType: 'tokens',
            featureId: 'trade_analyzer',
            ruleCode: TRADE_REVIEW_TOKEN_RULE,
          })
          window.location.assign(tradeReviewPath(id))
        }}
      >
        {children}
      </button>
      {failed ? <p className="af-core-lock-body" role="alert">{storageError}</p> : null}
    </div>
  )
}

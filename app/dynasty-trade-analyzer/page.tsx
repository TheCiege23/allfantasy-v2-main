import { permanentRedirect } from 'next/navigation'

/**
 * Retired 2026-11-12 (owner's call): the trade tools are one Trade Analyzer. This page's grade was
 * the same engine's (`evaluateTrade`) as the evaluator's league tab, which also carries the share
 * link this page had (TradeShareButton → /trade/{id}, unchanged). Its second-opinion AI review
 * (OpenAI + Grok) was not carried over. A 308 keeps bookmarks, share-page footers and old links
 * working.
 */
export default function DynastyTradeAnalyzerPage() {
  permanentRedirect('/trade-evaluator?mode=league')
}

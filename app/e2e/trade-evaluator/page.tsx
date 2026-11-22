import { notFound } from 'next/navigation'
import TradeEvaluatorHarnessClient from './TradeEvaluatorHarnessClient'

/**
 * DB-free render of the /core Trades hub's league trade evaluator inside the real AfCoreShell, for
 * visual review (scripts/trade-evaluator-capture.mjs). Production is refused here and by
 * app/e2e/layout.tsx. Mode comes from the real `af_mode` cookie the root layout reads; the roster
 * read is answered by the capture script with SAMPLE data.
 *
 *   /e2e/trade-evaluator
 */
export default function TradeEvaluatorHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <TradeEvaluatorHarnessClient />
}

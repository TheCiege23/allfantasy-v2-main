import { notFound } from 'next/navigation'
import HomeTradeEvaluatorHarnessClient from './HomeTradeEvaluatorHarnessClient'

/**
 * DB-free render of Home's folded "Evaluate a trade" card inside the real AfCoreShell, for visual
 * review. Production is refused here and by app/e2e/layout.tsx. Mode comes from the `af_mode` cookie.
 *
 *   /e2e/home-trade-evaluator
 */
export default function HomeTradeEvaluatorHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <HomeTradeEvaluatorHarnessClient />
}

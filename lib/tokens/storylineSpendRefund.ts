import 'server-only'

import { TokenSpendService } from '@/lib/tokens/TokenSpendService'

/**
 * Give back the tokens a storyline request spent when the story itself failed — the same
 * `feature_execution_failed` refund every other token-fallback route uses (player comparison,
 * trade analyzer, Chimmy). Idempotent per ledger entry, and never throws: a refund that cannot be
 * written is logged, and the caller's own error still reaches the person.
 */
export async function refundStorylineSpend(args: {
  userId: string
  ledgerId: string
  /** `league_drama_tell_story` or `league_story_create` — the spend's own source type. */
  surface: string
}): Promise<void> {
  await new TokenSpendService()
    .refundSpendByLedger({
      userId: args.userId,
      spendLedgerId: args.ledgerId,
      refundRuleCode: 'feature_execution_failed',
      sourceType: `${args.surface}_refund`,
      sourceId: args.ledgerId,
      idempotencyKey: `refund:${args.surface}:${args.ledgerId}`,
      description: 'Auto refund: the story could not be written.',
      metadata: {},
    })
    .catch((error: unknown) => {
      console.warn('[storyline] refund failed', { ledgerId: args.ledgerId, surface: args.surface, error })
    })
}

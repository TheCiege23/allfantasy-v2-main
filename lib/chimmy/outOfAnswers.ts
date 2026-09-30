/**
 * What the chat drawer says, and offers, when a Chimmy answer cannot be bought.
 *
 * 🛑 THIS WAS A DEAD END AT THE ONE MOMENT A FREE USER IS MOST LIKELY TO PAY. Running out of tokens
 * printed "You are out of tokens, so this answer was not bought. Top up and ask again." as a bare
 * line of red text: no way to buy, no mention of AF Pro, and the question stayed stuck in the
 * transcript. Every free account meets it after two questions a day. It now names both ways to keep
 * going, with links, and hands the question back so buying and re-asking is one click and one send.
 *
 * Client-safe on purpose (the drawer renders it), so it reads its numbers from the two client-safe
 * definitions rather than restating them: the AF Pro daily allowance and the free daily floor.
 */

import type { ChimmyPlanAllowanceView } from './planAllowanceView'
import { CHIMMY_PLAN_DAILY_INCLUDED } from './planAllowanceView'
import { FREE_CHIMMY_QUESTIONS_PER_DAY } from '@/lib/tokens/freeChimmyQuestions'

/** The token store. `from` says where the buyer came from; the page ignores what it does not use. */
export const CHIMMY_BUY_TOKENS_HREF = '/tokens?from=chimmy-drawer'
/** AF Pro on the purchase surface — `/upgrade` focuses the plan named by `plan`. */
export const CHIMMY_AF_PRO_HREF = '/upgrade?plan=af_pro&from=chimmy-drawer'

export type OutOfAnswersAction = { label: string; href: string; primary: boolean }

export type OutOfAnswers = {
  title: string
  body: string
  actions: OutOfAnswersAction[]
}

/**
 * `plan` is the caller's Chimmy allowance when their plan includes Chimmy, else null.
 *
 * ⚠ A PLAN HOLDER IS NEVER SOLD THE PLAN THEY HAVE. Reaching this with a plan means the day's
 * included answers are used AND the token balance is empty, so the only useful offer is tokens —
 * "Get AF Pro" to an AF Pro subscriber reads as though we lost track of what they bought.
 *
 * 🛑 INSIDE THE iOS APP IT OFFERS NOTHING TO BUY (App Store 3.1.1). The app sells no plan or tokens,
 * and its CSS already hid the two links — but the BODY still said "AF Pro includes … or buy tokens
 * to keep going now", which points a reviewer at a purchase the app cannot make. In the app the card
 * says only what is true there: when the answers come back.
 */
/**
 * The AI-access line for a surface inside the iOS app. `AIAccessResolver`'s message ends in
 * "Upgrade or buy tokens for more" for a free account — true on the web, a purchase pointer in the
 * app (3.1.1) — so the app shows this instead, built from the same status fields.
 */
export function inIosAppAccessLine(status: { hasSubscription: boolean; tokenBalance: number }): string {
  if (status.hasSubscription) return 'Premium AI active.'
  if (status.tokenBalance > 0) {
    return `${status.tokenBalance} AI token${status.tokenBalance === 1 ? '' : 's'} available.`
  }
  return `${FREE_CHIMMY_QUESTIONS_PER_DAY} free Chimmy questions a day.`
}

export function describeOutOfAnswers(
  plan: ChimmyPlanAllowanceView | null,
  opts: { inIosApp?: boolean } = {},
): OutOfAnswers {
  const buyTokens = (primary: boolean): OutOfAnswersAction => ({ label: 'Buy tokens', href: CHIMMY_BUY_TOKENS_HREF, primary })
  const free = FREE_CHIMMY_QUESTIONS_PER_DAY

  if (opts.inIosApp) {
    return plan
      ? {
          title: `Today's ${plan.limit} ${plan.planName} answers are used`,
          body: `This answer was not bought. Your ${plan.planName} answers refill at midnight UTC.`,
          actions: [],
        }
      : {
          title: 'You are out of Chimmy answers',
          body:
            `This answer was not bought. Your ${free} free ` +
            `${free === 1 ? 'question comes' : 'questions come'} back at midnight UTC.`,
          actions: [],
        }
  }

  if (plan) {
    return {
      title: `Today's ${plan.limit} ${plan.planName} answers are used`,
      body:
        'You are out of tokens too, so this answer was not bought. Buy tokens to keep going now — ' +
        `your ${plan.planName} answers refill at midnight UTC.`,
      actions: [buyTokens(true)],
    }
  }

  return {
    title: 'You are out of Chimmy answers',
    body:
      `This answer was not bought — you are out of tokens. AF Pro includes ${CHIMMY_PLAN_DAILY_INCLUDED} ` +
      `Chimmy answers a day, or buy tokens to keep going now. Your ${free} free ` +
      `${free === 1 ? 'question comes' : 'questions come'} back at midnight UTC.`,
    actions: [{ label: 'Get AF Pro', href: CHIMMY_AF_PRO_HREF, primary: true }, buyTokens(false)],
  }
}

import type { PartnerSettings } from './settings'

/** What the home card and the account menu say about Partner Codes. */
export type PartnerNudge =
  | { show: false }
  | {
      show: true
      claimed: boolean
      code: string | null
      /** One line, the headline. */
      title: string
      /** One line under it. */
      body: string
      /** Button text. */
      action: string
      /** Short hint beside the menu item. */
      menuHint: string
    }

type CodeRow = {
  code: string
  status: string
  paidSubsCount: number
  activeUsersCount: number
  cashUnlockedAt: Date | null
  freePlan: string
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/**
 * Pure copy for the nudge, so it is tested without a database. Says each number
 * once and names the next step, the same way the Partner Code page headline does.
 */
export function buildPartnerNudge(args: {
  code: CodeRow | null
  isCommissioner: boolean
  settings: Pick<PartnerSettings, 'discountPercent' | 'discountMonths' | 'commissionPercent' | 'cashThresholdPaidSubs'>
}): PartnerNudge {
  const { code, isCommissioner, settings: s } = args
  // A suspended or closed code is handled on the Partner Code page, not advertised on home.
  if (code && code.status !== 'active') return { show: false }
  if (!code && !isCommissioner) return { show: false }

  if (!code) {
    return {
      show: true,
      claimed: false,
      code: null,
      title: 'Earn with your league',
      body: `Get a Partner Code. Friends save ${s.discountPercent}% for ${s.discountMonths} months, and you unlock free plans, then ${s.commissionPercent}% cash.`,
      action: 'Make my code',
      menuHint: 'earn',
    }
  }

  if (code.cashUnlockedAt) {
    return {
      show: true,
      claimed: true,
      code: code.code,
      title: `Your code ${code.code} is earning`,
      body: `${s.commissionPercent}% cash from ${plural(code.paidSubsCount, 'paid subscriber', 'paid subscribers')}.`,
      action: 'See earnings',
      menuHint: code.code,
    }
  }

  const toCash = Math.max(0, s.cashThresholdPaidSubs - code.paidSubsCount)
  const free = code.freePlan === 'supreme' ? 'AF Supreme' : code.freePlan === 'commissioner' ? 'AF Commissioner' : null
  return {
    show: true,
    claimed: true,
    code: code.code,
    title: `${plural(toCash, 'more paid subscriber', 'more paid subscribers')} to start earning ${s.commissionPercent}% cash`,
    body: free ? `You have ${free} free. Keep sharing ${code.code}.` : `Share ${code.code} in your league chat.`,
    action: 'Open my code',
    menuHint: code.code,
  }
}

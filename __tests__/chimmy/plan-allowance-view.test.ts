import { describe, expect, it } from 'vitest'

import {
  CHIMMY_PLAN_DAILY_INCLUDED,
  describeAllowanceNote,
  describeAnswerAllowance,
  readPlanAllowanceView,
} from '@/lib/chimmy/planAllowanceView'
import { getMonetizationCatalog } from '@/lib/monetization/catalog'

const VIEW = { included: true, planName: 'AF Pro', used: 37, limit: 100, resetsAt: '2026-09-25T00:00:00.000Z' }

describe('readPlanAllowanceView', () => {
  it('keeps a well-formed allowance', () => {
    expect(readPlanAllowanceView(VIEW)).toEqual(VIEW)
    expect(readPlanAllowanceView({ ...VIEW, released: true })).toMatchObject({ released: true })
  })

  it.each([
    ['nothing', undefined],
    ['no plan name', { ...VIEW, planName: '' }],
    ['a zero limit', { ...VIEW, limit: 0 }],
    ['a negative count', { ...VIEW, used: -1 }],
    ['a string count', { ...VIEW, used: '37' }],
    ['no included flag', { ...VIEW, included: 'yes' }],
  ])('drops %s rather than render a wrong count', (_label, value) => {
    expect(readPlanAllowanceView(value)).toBeNull()
  })
})

describe('allowance copy', () => {
  it('under an included answer', () => {
    expect(describeAnswerAllowance(VIEW)).toBe('Included with AF Pro · 37 of 100 today')
  })

  it('under an answer past the allowance', () => {
    expect(describeAnswerAllowance({ ...VIEW, included: false, used: 100 })).toBe(
      "AF Pro's 100 daily answers are used — this one used tokens",
    )
  })

  it('under an included answer that was never delivered', () => {
    expect(describeAnswerAllowance({ ...VIEW, released: true })).toMatch(/^Not counted/)
  })

  it('in the composer, with answers left and with none', () => {
    expect(describeAllowanceNote(VIEW, 10)).toBe(
      'Included with AF Pro: 63 of 100 Chimmy answers left today. After that, answers cost 10 tokens.',
    )
    expect(describeAllowanceNote({ ...VIEW, used: 100 }, 10)).toMatch(/used — they refill at midnight UTC\. Until then, answers cost 10 tokens\./)
  })
})

/* The pricing page cannot promise one number while the counter enforces another. */
describe('the promise matches the counter', () => {
  it('states the shared daily number in the AF Pro catalog copy', () => {
    const pro = getMonetizationCatalog().subscriptions.filter((s) => s.planFamily === 'af_pro')
    expect(pro.map((s) => s.sku).sort()).toEqual(['af_pro_monthly', 'af_pro_yearly'])
    for (const item of pro) expect(item.description).toContain(`${CHIMMY_PLAN_DAILY_INCLUDED} Chimmy answers a day`)
  })
})

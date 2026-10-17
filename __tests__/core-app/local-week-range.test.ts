// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { localWeekRange } from '@/lib/core-app/localWeekRange'
describe('viewer local week', () => {
  it('keeps Sunday in the week that started the preceding Monday', () => {
    const { start, end } = localWeekRange(new Date(2026, 9, 4, 12))
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 8, 28])
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 9, 4])
  })
  it('crosses a year boundary without borrowing a league season', () => {
    const { start, end } = localWeekRange(new Date(2027, 0, 1, 12))
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 11, 28])
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2027, 0, 3])
  })
  it('uses calendar dates across the daylight-saving change', () => {
    const { start, end } = localWeekRange(new Date(2026, 10, 1, 12))
    expect(start.getDay()).toBe(1)
    expect(end.getDay()).toBe(0)
    expect(end.getDate()).toBe(1)
  })
})

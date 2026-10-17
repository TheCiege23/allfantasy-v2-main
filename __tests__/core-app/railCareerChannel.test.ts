// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentRailCareerLines,
  publishRailCareerLines,
  RAIL_CAREER_EVENT,
  railLeagueKey,
  type RailCareerDetail,
} from '@/lib/core-app/railCareerChannel'

afterEach(() => publishRailCareerLines(null))

describe('railCareerChannel', () => {
  it('keeps the latest lines, so a shell that subscribes AFTER the screen published still gets them', () => {
    publishRailCareerLines({ 'dynasty dragons': '23-11 · 2 titles' })
    // The shell mounts later (a parent's effects run after its child's) and reads what is there.
    expect(currentRailCareerLines()).toEqual({ 'dynasty dragons': '23-11 · 2 titles' })
  })

  it('announces every change, including the clear on leaving Career', () => {
    const seen: Array<RailCareerDetail['lines']> = []
    const on = (e: Event) => seen.push((e as CustomEvent<RailCareerDetail>).detail.lines)
    window.addEventListener(RAIL_CAREER_EVENT, on)
    publishRailCareerLines({ a: '1-0' })
    publishRailCareerLines(null)
    window.removeEventListener(RAIL_CAREER_EVENT, on)
    expect(seen).toEqual([{ a: '1-0' }, null])
    expect(currentRailCareerLines()).toBeNull()
  })

  it('keys on the trimmed, lower-cased name — the Career identity', () => {
    expect(railLeagueKey('  Dynasty Dragons ')).toBe('dynasty dragons')
    expect(railLeagueKey(null)).toBe('')
  })

  it('stores without a window (server render) and never throws', () => {
    const spy = vi.spyOn(window, 'dispatchEvent')
    publishRailCareerLines({ x: '2-2' })
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

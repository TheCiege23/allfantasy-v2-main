/**
 * Owner decision 2026-10-20: after the matchup-simulator → simulation-lab rename, the tool landing
 * page's `landing_tool_visit` event reports the NEW path, /tools/simulation-lab. (Briefly an
 * `analyticsPath` override kept the old path; it was removed.) Every tool reports /tools/<slug>.
 */
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const trackLandingToolVisit = vi.fn()
vi.mock('@/lib/landing-analytics', () => ({ trackLandingToolVisit: (p: unknown) => trackLandingToolVisit(p) }))

// Chrome around the article is irrelevant to the analytics call.
vi.mock('@/components/navigation/HomeTopNav', () => ({ default: () => null }))
vi.mock('@/components/landing/SeoLandingFooter', () => ({ default: () => null }))
vi.mock('@/components/landing/LandingCTAStrip', () => ({ LandingCTAStrip: () => null }))
vi.mock('@/components/landing/RelatedToolsSection', () => ({ RelatedToolsSection: () => null }))
vi.mock('@/components/seo/ShareButtons', () => ({ ShareButtons: () => null }))

import ToolLandingClient from '@/app/tools/[tool]/ToolLandingClient'
import { TOOL_CONFIG, TOOL_SLUGS } from '@/lib/seo-landing/config'

afterEach(() => {
  cleanup()
  trackLandingToolVisit.mockClear()
})

describe('landing_tool_visit path', () => {
  it('the Simulation Lab page reports /tools/simulation-lab', () => {
    render(<ToolLandingClient config={TOOL_CONFIG['simulation-lab']} />)
    expect(trackLandingToolVisit).toHaveBeenCalledTimes(1)
    expect(trackLandingToolVisit).toHaveBeenCalledWith({
      path: '/tools/simulation-lab',
      tool_name: 'Simulation Lab',
    })
  })

  it('no tool config carries a path override', () => {
    for (const slug of TOOL_SLUGS) {
      expect(Object.keys(TOOL_CONFIG[slug])).not.toContain('analyticsPath')
    }
  })
})

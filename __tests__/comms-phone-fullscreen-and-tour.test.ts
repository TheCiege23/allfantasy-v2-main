import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Two owner decisions from the chat live test (2026-09-25):
 *   - "Full-screen on phones": the chat drawer was an inset card on a phone (page showing around it);
 *   - "Move the tour card": the welcome tour sat on top of the chat bubble, so it could not be tapped.
 *
 * Geometry was measured in Chromium, before and after, at 390x844, 375x667, 820x1180 and 1280x800:
 * phones went from [19,16,354,810] with a 26px radius to [0,0,390,844] with none; tablet and desktop
 * were byte-identical; the tour card overlapped the bubble at all four sizes before and at none after.
 * jsdom applies no media queries, so these pin the rules that produced that — anchored to line
 * starts, so a comment ABOUT a rule cannot satisfy them.
 */

const comms = readFileSync(join(process.cwd(), 'components/core-app/af-comms.css'), 'utf8')
const tour = readFileSync(join(process.cwd(), 'components/core-app/core-welcome-tour.css'), 'utf8')

describe('chat is the whole screen on a phone', () => {
  const layer = comms.slice(comms.lastIndexOf('── Phones: chat is the whole screen ──'))
  const phone = layer.slice(layer.indexOf('@media (max-width: 520px)'))

  it('is the last word in the stylesheet, so no earlier inset-card layer wins', () => {
    expect(comms.lastIndexOf('── Phones: chat is the whole screen ──')).toBeGreaterThan(comms.lastIndexOf('── A short screen'))
    expect(phone.length).toBeGreaterThan(0)
  })

  it('pins the dialog edge to edge with no border or radius', () => {
    const block = phone.slice(phone.indexOf("  .af-cm[data-mode='overlay'] {"), phone.indexOf('  }', phone.indexOf("  .af-cm[data-mode='overlay'] {")))
    for (const rule of ['top: 0;', 'right: 0;', 'bottom: 0;', 'left: 0;', 'width: 100%;', 'border: 0;', 'border-radius: 0;', 'max-height: none;']) {
      expect(block).toContain(rule)
    }
  })

  it('keeps the notch and home bar off the header and footer', () => {
    expect(phone).toMatch(/^\s+\.af-cm\[data-mode='overlay'\] \.af-cm-head \{ padding-top: max\(10px, env\(safe-area-inset-top/m)
    expect(phone).toMatch(/^\s+\.af-cm\[data-mode='overlay'\] \.af-cm-foot \{ padding-bottom: calc\(8px \+ env\(safe-area-inset-bottom/m)
  })

  it('with the keyboard up, fills the visible region with no margins', () => {
    expect(phone).toMatch(/^\s+\.af-cm\[data-mode='overlay'\]\[data-keyboard='open'\] \{$/m)
    expect(phone).toContain('top: var(--af-comms-vv-top, 0px);')
    expect(phone).toContain('height: var(--af-comms-vh, 100dvh);')
  })
})

describe('the welcome tour sits above the chat bubble, not on it', () => {
  const base = tour.slice(tour.indexOf('.af-welcome {'), tour.indexOf('}', tour.indexOf('.af-welcome {')))
  const phoneStart = tour.indexOf('@media (max-width: 720px)')
  const phone = tour.slice(phoneStart, tour.indexOf('}', tour.indexOf('.af-welcome {', phoneStart)))

  it('anchors to slot 1 of the corner geometry — the bubble is slot 0 — at every width', () => {
    expect(base).toMatch(/^\s+bottom: var\(--af-fab-slot-1, 86px\);$/m)
    expect(base).toMatch(/^\s+right: var\(--af-fab-inset, 18px\);$/m)
    expect(phone).toMatch(/^\s+bottom: var\(--af-fab-slot-1, 136px\);$/m)
  })

  it('no longer uses the fixed corner offsets that put it on the bubble', () => {
    expect(base).not.toMatch(/^\s+bottom: 24px;$/m)
    expect(phone).not.toContain('bottom: calc(82px')
  })

  it('shrinks its height by the slot it now starts from, so it cannot run off the top', () => {
    expect(phone).toContain('max-height: min(440px, calc(100dvh - var(--af-fab-slot-1, 136px) - 16px - env(safe-area-inset-top, 0px)));')
  })
})

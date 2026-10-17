/**
 * Fun mode: the drawer sends tone=fun, and the route turns that into explicit emoji rules rather
 * than a bare "Tone: fun" the model would interpret on its own.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { FUN_MODE_DIRECTIVE, FUN_MODE_TONE, isFunModeTone } from '@/lib/chimmy/funMode'

describe('Chimmy fun mode', () => {
  it('recognises the tone the drawer sends, and nothing else', () => {
    expect(isFunModeTone(FUN_MODE_TONE)).toBe(true)
    expect(isFunModeTone(' Fun ')).toBe(true)
    expect(isFunModeTone('engaging')).toBe(false)
    expect(isFunModeTone(null)).toBe(false)
  })

  it('keeps emojis out of numbers, grades and refusals', () => {
    expect(FUN_MODE_DIRECTIVE).toMatch(/Never put an emoji inside a number, a grade/)
    expect(FUN_MODE_DIRECTIVE).toMatch(/No emojis at all when you are refusing/)
  })

  it('the route renders the directive for tone=fun instead of a bare Tone line', () => {
    const route = readFileSync('app/api/chat/chimmy/route.ts', 'utf8')
    expect(route).toMatch(/^\s*if \(isFunModeTone\(input\.tone\)\) \{\n\s*parts\.push\(`RESPONSE STYLE — FUN MODE:\\n\$\{FUN_MODE_DIRECTIVE\}`\)/m)
    expect(route).toMatch(/input\.tone && !isFunModeTone\(input\.tone\) \? `Tone: \$\{input\.tone\}`/)
  })

  it('the drawer sends tone=fun only when the toggle is on', () => {
    const panel = readFileSync('components/core-app/comms/ChimmyPanel.tsx', 'utf8')
    expect(panel).toMatch(/^\s*if \(funMode\) form\.append\('tone', FUN_MODE_TONE\)/m)
  })
})

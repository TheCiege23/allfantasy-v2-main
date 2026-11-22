// @vitest-environment jsdom
/**
 * IDP salary-cap screens (Cap Room, Contract Center), 2026-11-09 visual audit (phone + desktop, dark + light,
 * DB-free harness at /e2e/idp/[leagueId]/[screen]).
 *
 * 1. 🛑 `bg-[color:var(--cap-green)]/25` COMPILES TO NOTHING. Tailwind cannot apply an opacity to a colour it
 *    only knows as a CSS variable, so it emits no rule and the element stays transparent. Every cap and IDP stat
 *    colour with an opacity was written that way — the contract timeline drew no bars (only a franchise tag,
 *    which used a plain `bg-amber-500/35`, showed), the cap bar had no "available" segment, and the cap chips,
 *    player-card badges and draft filters had no tint and a default grey border. The colours are now Tailwind
 *    palettes over RGB-channel tokens (`bg-cap-green/25`, `bg-idp-defense/25`).
 * 2. Always dark: the light-mode clamp recoloured these dark screens near-invisible; their layouts carry
 *    `af-draft-dark`.
 * 3. Internal wording: "AfSub" (the plan's code) and "wire to `zombieHost` jobs" reached users across IDP, C2C
 *    and Zombie AI surfaces; they name the plan, AF Commissioner.
 */
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams('rosterId=r1'),
  useRouter: () => ({ push: () => {} }),
}))

import IdpCapLayout from '@/app/idp/cap/layout'
import IdpContractsLayout from '@/app/idp/contracts/layout'
import { ContractCenterClient } from '@/app/idp/contracts/[leagueId]/ContractCenterClient'

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require(path.join(ROOT, 'tailwind.config.js'))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function compile(classes: string): Promise<string> {
  const out = await postcss([tailwind({ ...config, content: [{ raw: `<div class="${classes}"></div>`, extension: 'html' }], corePlugins: { preflight: false } })])
    .process('@tailwind utilities;', { from: undefined })
  return out.css
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'e2e') tsxFiles(rel, out) } else if (rel.endsWith('.tsx')) out.push(rel)
  }
  return out
}
const SOURCES = [...tsxFiles('app'), ...tsxFiles('components')]

describe('cap and IDP stat colours with an opacity', () => {
  // Positive control: the form the code used compiles to nothing — the bug itself.
  it('proves a var() colour with an opacity emits no CSS', async () => {
    const css = await compile('bg-[color:var(--cap-green)]/25')
    expect(css).not.toContain('--cap-green')
  })

  it('emits a real colour for the palette form', async () => {
    const css = await compile('bg-cap-green/25 border-idp-defense/45')
    expect(css).toContain('rgb(var(--cap-green-rgb) / 0.25)')
    expect(css).toContain('rgb(var(--idp-defense-rgb) / 0.45)')
  })

  it('keeps every channel token equal to its hex token', () => {
    const globals = read('app/globals.css')
    const hexOf = (name: string) => new RegExp(`--${name}:\\s*#([0-9a-f]{6});`, 'i').exec(globals)?.[1]
    for (const [family, keys] of Object.entries({ cap: config.theme.extend.colors.cap, idp: config.theme.extend.colors.idp }) as [string, Record<string, string>][]) {
      for (const key of Object.keys(keys)) {
        const hex = hexOf(`${family}-${key}`)
        const channels = new RegExp(`--${family}-${key}-rgb:\\s*([0-9 ]+);`).exec(globals)?.[1]
        expect(hex, `${family}-${key}`).toBeTruthy()
        expect(channels?.trim().split(/\s+/).map(Number)).toEqual([0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16)))
      }
    }
  })

  it('leaves no cap or IDP colour written as var() with an opacity', () => {
    const offenders = SOURCES.filter((f) => /\[(color:)?var\(--(cap|idp)-[a-z]+\)\]\/\d/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('uses only palette keys that exist', () => {
    const used = new Set<string>()
    for (const f of SOURCES) for (const m of read(f).matchAll(/-(cap|idp)-([a-z]+)\/\d+/g)) used.add(`${m[1]}.${m[2]}`)
    for (const k of used) {
      const [family, key] = k.split('.') as [string, string]
      expect(config.theme.extend.colors[family]?.[key], k).toBeTruthy()
    }
  })
})

describe('Contract Center timeline', () => {
  it('draws a bar for every contract, coloured by state', async () => {
    const contract = (id: string, playerName: string, yearsRemaining: number, isFranchiseTagged = false) => ({
      id, leagueId: 'L1', rosterId: 'r1', playerId: id, playerName, position: 'LB', isDefensive: true, salary: 10, contractYears: 3,
      yearsRemaining, contractStartYear: 2025, status: 'active', acquisitionMethod: 'auction', isFranchiseTagged, cutPenaltyCurrent: 2,
    })
    const contracts = [contract('a', 'Fred Warner', 2), contract('b', 'Roquan Smith', 1), contract('c', 'Bijan Robinson', 2, true)]
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const u = String(input)
      const json = (body: unknown) => ({ ok: true, json: async () => body })
      if (u.includes('type=contracts')) return json({ contracts })
      if (u.includes('type=summary')) return json({ season: 2026, totalCap: 200, activeSalary: 30, deadMoney: 0, totalCapUsed: 30, availableCap: 170, isCapCompliant: true, holdbackReserved: 0, effectiveSpendableCap: 170 })
      if (u.includes('type=dead_money')) return json({ deadMoney: [] })
      return json({ season: { rosters: [{ id: 'r1', teamName: 'Blitz Package' }] } })
    }))
    render(<ContractCenterClient leagueId="L1" />)
    const bar = async (name: string) => {
      const row = (await screen.findAllByText(name))[0]!.parentElement as HTMLElement
      return row.querySelector('[title$="yr"]')!.className
    }
    const [under, expiring, tagged] = [await bar('Fred Warner'), await bar('Roquan Smith'), await bar('Bijan Robinson')]
    expect(under).toMatch(/\bbg-cap-green\/\d+/)
    expect(expiring).toMatch(/\bbg-cap-amber\/\d+/)
    expect(tagged).toMatch(/\bbg-violet-500\/\d+/)
    expect(new Set([under, expiring, tagged]).size).toBe(3)
  })
})

describe('IDP cap screens are dark in every mode', () => {
  it.each([['cap', IdpCapLayout], ['contracts', IdpContractsLayout]])('wraps /idp/%s in the always-dark opt-out', (_n, Layout) => {
    const { container } = render(<Layout><p>x</p></Layout>)
    expect((container.firstElementChild as HTMLElement).className.split(/\s+/)).toContain('af-draft-dark')
  })
})

describe('the plan is named, never coded', () => {
  it('shows "AfSub" to no user, anywhere', () => {
    const offenders: string[] = []
    for (const f of SOURCES) {
      read(f).split('\n').forEach((line, i) => {
        if (!/\bAfSub\b/.test(line)) return
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        offenders.push(`${f}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

// @vitest-environment jsdom
/**
 * The one-league Commissioner Hub follows the language switch (2026-10-05).
 *
 * Every hub component is parsed with the TypeScript compiler, and the suite fails on:
 *  - English written straight into JSX (text or a text attribute), which nothing can translate;
 *  - a literal handed to `t()` / `hubCopy()` that has no Spanish;
 *  - any other prose literal in the file without Spanish — the errors and notes a component sets
 *    and renders through `t()` later.
 * So a new label without Spanish fails here, not in front of a Spanish reader.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { cleanup, render, screen } from '@testing-library/react'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/core-app/commissioner/reports', () => ({
  loadAuditTimeline: () => Promise.resolve({ available: true, data: [] }),
  loadActivityCharts: () => Promise.resolve({ available: false, reason: 'n/a' }),
}))
// The streamed sections are async server components; the scan above covers their copy.
vi.mock('@/components/core-app/commissioner/HubReports', () => ({
  OperationalCharts: () => null,
  ChartsFallback: () => null,
  RecentChanges: () => null,
  RecentChangesFallback: () => null,
  AuditTimeline: () => null,
  AuditTimelineFallback: () => null,
}))
vi.mock('@/components/commish/BroadcastModal', () => ({ default: () => null }))
vi.mock('@/components/league-hub/CommissionerOsActionsSummary', () => ({ CommissionerOsActionsSummary: () => null }))

import { CommissionerHub } from '@/components/core-app/screens/CommissionerHub'
import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

const FILES = [
  'components/core-app/screens/CommissionerHub.tsx',
  'components/core-app/commissioner/HubSections.tsx',
  'components/core-app/commissioner/HubReports.tsx',
  'components/core-app/commissioner/AnnounceButton.tsx',
  'components/core-app/commissioner/AutomationRecipes.tsx',
  'components/core-app/commissioner/CalendarExportButton.tsx',
  'components/core-app/commissioner/CommissionerChimmy.tsx',
  'components/core-app/commissioner/FormatTemplateControl.tsx',
  'components/core-app/commissioner/GuidedWorkflows.tsx',
  'components/core-app/commissioner/MemberActivityList.tsx',
  'components/core-app/commissioner/TimelineList.tsx',
  'components/core-app/PublishStandingsToggle.tsx',
  'components/core-app/WaiverOversight.tsx',
]

/** Attributes whose string value is shown to a reader. */
const TEXT_ATTRS = new Set(['aria-label', 'title', 'label', 'placeholder', 'alt', 'note', 'caveat', 'what'])

/** A placeholder's sample value. */
function sample(expr: string): string {
  return /\?/.test(expr) && /:/.test(expr) ? '' : '7'
}

/** The text a string-ish literal renders, placeholders filled; null for anything else. */
function literalText(node: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text
    for (const span of node.templateSpans) out += sample(span.expression.getText(sf)) + span.literal.text
    return out
  }
  return null
}

/** Every literal that can be the value of `node` — through ternaries, `??`, `||` and parentheses. */
function valueLiterals(node: ts.Node, sf: ts.SourceFile): string[] {
  const text = literalText(node, sf)
  if (text != null) return [text]
  if (ts.isParenthesizedExpression(node)) return valueLiterals(node.expression, sf)
  if (ts.isConditionalExpression(node)) return [...valueLiterals(node.whenTrue, sf), ...valueLiterals(node.whenFalse, sf)]
  if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    return [...valueLiterals(node.left, sf), ...valueLiterals(node.right, sf)]
  }
  return []
}

const isProse = (s: string) => /[A-Za-z]{2,}/.test(s)

type Findings = { rawJsx: string[]; translated: string[]; prose: string[] }

function scan(file: string): Findings {
  const src = readFileSync(resolve(process.cwd(), file), 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: Findings = { rawJsx: [], translated: [], prose: [] }
  const claimed = new Set<ts.Node>()

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) return

    // English straight in JSX text.
    if (ts.isJsxText(node) && isProse(node.text)) found.rawJsx.push(node.text.trim())

    // A string attribute a reader sees.
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sf)
      if (TEXT_ATTRS.has(name) && isProse(node.initializer.text)) found.rawJsx.push(`${name}="${node.initializer.text}"`)
      claimed.add(node.initializer)
    }

    // Literals handed to the translator.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 't' || node.expression.text === 'hubCopy')) {
      const arg = node.arguments[0]
      if (arg) {
        for (const s of valueLiterals(arg, sf)) if (isProse(s)) found.translated.push(s)
        const mark = (n: ts.Node) => {
          if (literalText(n, sf) != null) claimed.add(n)
          n.forEachChild(mark)
        }
        mark(arg)
      }
    }

    // Any other prose literal: the errors and notes set now and rendered through t() later.
    const text = literalText(node, sf)
    if (text != null && !claimed.has(node) && /^[ —(]*[A-Z][a-z]/.test(text) && !/[/=]/.test(text)) {
      const parent = node.parent
      const isKey = parent && ts.isPropertyAssignment(parent) && parent.name === node
      const inAttr = parent && ts.isJsxAttribute(parent)
      // A label map's value is one word as often as not ("Tasks", "Inactive") — rendered as t(MAP[key]).
      const isMapValue = parent && ts.isPropertyAssignment(parent) && parent.initializer === node
      if (!isKey && !inAttr && (/\s/.test(text) || isMapValue)) found.prose.push(text)
    }

    node.forEachChild(visit)
  }
  visit(sf)
  return found
}

describe('commissioner hub copy', () => {
  const results = FILES.map((file) => ({ file, ...scan(file) }))

  it('the scan sees the hub’s real copy', () => {
    const total = results.reduce((n, r) => n + r.translated.length + r.prose.length, 0)
    expect(total).toBeGreaterThanOrEqual(150)
    for (const r of results) expect(r.translated.length + r.prose.length, r.file).toBeGreaterThan(0)
  })

  it('🛑 no English is written straight into JSX', () => {
    expect(results.flatMap((r) => r.rawJsx.map((s) => `${r.file}: ${s}`))).toEqual([])
  })

  it('🛑 every literal the hub hands to its translator has Spanish', () => {
    const missing = results.flatMap((r) => r.translated.filter((s) => hubCopy(s, 'es') === s).map((s) => `${r.file}: ${s}`))
    expect([...new Set(missing)]).toEqual([])
  })

  it('🛑 every other prose literal in a hub component has Spanish', () => {
    const missing = results.flatMap((r) => r.prose.filter((s) => hubCopy(s, 'es') === s).map((s) => `${r.file}: ${s}`))
    expect([...new Set(missing)]).toEqual([])
  })

  it('leaves English untouched and passes unknown text through', () => {
    expect(hubCopy('Needs you now', 'en')).toBe('Needs you now')
    expect(hubCopy('A sentence nobody wrote yet', 'es')).toBe('A sentence nobody wrote yet')
    expect(hubCopy(undefined, 'es')).toBe('')
  })

  it('keeps the names a template carries, and never half-translates a sentence it does not know', () => {
    expect(hubCopy('You are a member of Dynasty Dragons. Ask its commissioner to add you as a co-commissioner if you need this.', 'es')).toBe(
      'Eres miembro de Dynasty Dragons. Pide a su comisionado que te añada como cocomisionado si lo necesitas.',
    )
    expect(hubCopy('Round 3, pick 27: quiet-owl selected Puka Nacua', 'es')).toBe('Ronda 3, selección 27: quiet-owl eligió a Puka Nacua')
    expect(hubCopy('On Sleeper', 'es')).toBe('En Sleeper')
    // A server sentence that merely starts like a template stays whole, in English, until it has its own entry.
    expect(hubCopy('On Sunday, set lineups before kickoff', 'es')).toBe('On Sunday, set lineups before kickoff')
    expect(hubCopy('Use the waiver tool to add a player', 'es')).toBe('Use the waiver tool to add a player')
  })
})

function hub(over: Partial<CommissionerHubData> = {}): CommissionerHubData {
  return {
    allowed: true,
    formatCards: [],
    network: null,
    history: { tradeAvailable: true, draftAvailable: true, trades: [], drafts: [], tradeNote: '', draftNote: '' },
    grant: {} as CommissionerHubData['grant'],
    league: { id: 'L1', name: 'Dynasty Dragons', platform: 'sleeper', season: 2026, native: false },
    role: 'commissioner',
    viewerIsOwner: true,
    viewerCanBroadcast: true,
    tiles: [],
    tasks: { cards: [], overflow: [] },
    tasksEmptyReason: '',
    health: { score: { available: false, reason: '' }, flags: [] },
    members: { available: false, reason: '' },
    calendar: { events: [], gaps: [], ics: null } as unknown as CommissionerHubData['calendar'],
    areas: [],
    workflows: [],
    communities: [],
    recipes: { values: {}, saved: false, updatedAt: null, sendEnabled: false, catalog: [] } as unknown as CommissionerHubData['recipes'],
    charts: { scoring: null, balance: null, engagement: null },
    settings: [],
    access: [],
    unread: true,
    disputes: { available: false, reason: '' },
    publicStandings: { enabled: false, url: '/standings/L1' },
    waivers: null,
    art: { label: 'Dynasty', video: null, poster: '/af-robot-king.png' },
    chatHref: '/league/L1?view=league_chat',
    unclaimedTeams: 3,
    quietManagers: ['quiet-owl'],
    ...over,
  } as CommissionerHubData
}

describe('the Commissioner Hub follows en → es → en', () => {
  it('the server screen through its language prop, the islands through the provider', () => {
    const view = (language: 'en' | 'es') => {
      h.language = language
      return <CommissionerHub data={hub()} language={language} />
    }
    const { rerender } = render(view('en'))
    expect(screen.getByRole('link', { name: '← All leagues you run' })).toBeTruthy()
    expect(screen.getByText('Needs you now')).toBeTruthy()

    rerender(view('es'))
    expect(screen.getByRole('link', { name: '← Todas las ligas que diriges' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dynasty Dragons') // the league's own name stays
    expect(screen.getByText('Te necesita ahora')).toBeTruthy() // HubSections, a server section
    expect(screen.getByText('Aún sin medir')).toBeTruthy()
    expect(screen.getByText(/3 equipos aún no están conectados/)).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Secciones del centro del comisionado' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enviar @everyone' })).toBeTruthy() // AnnounceButton, given a label
    expect(screen.getByRole('button', { name: 'Preguntar a Chimmy' })).toBeTruthy() // CommissionerChimmy, a client island
    expect(screen.getByRole('button', { name: 'Publicar la clasificación' })).toBeTruthy() // PublishStandingsToggle
    expect(screen.queryByText('Needs you now')).toBeNull()

    rerender(view('en'))
    expect(screen.getByText('Needs you now')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask Chimmy' })).toBeTruthy()
  })
})

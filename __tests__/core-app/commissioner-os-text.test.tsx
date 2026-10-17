// @vitest-environment jsdom
/**
 * The Commissioner OS card follows the language switch (2026-10-05).
 *
 * The card's titles and summaries are written in English by four server sources. This suite scans
 * each source for the sentences that reach the card, fills their placeholders with sample values,
 * and requires Spanish for every one — so a new sentence without Spanish fails here. It then
 * renders the real card switching en -> es -> en.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { commissionerOsText } from '@/lib/core-app/commissionerOsText'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
}))

import { CommissionerOsActionsSummary } from '@/components/league-hub/CommissionerOsActionsSummary'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  h.language = 'en'
})

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

/** A placeholder's sample value, chosen so the template reads the way production fills it. */
function sample(expr: string): string {
  if (/\?/.test(expr) && /:/.test(expr)) return '' // a ternary suffix, e.g. an optional season
  if (/Tier/.test(expr)) return 'Heated'
  if (/band/.test(expr)) return 'stable'
  if (/eventType/.test(expr)) return 'drama'
  if (/\.grade\b/.test(expr)) return 'B'
  if (/rosterId/.test(expr)) return 'r1'
  if (/teamName|managerAId|managerBId|teamA|teamB|teamId|rising/.test(expr)) return 'Team Seven'
  return '7'
}

/**
 * Read one template literal starting at `src[i] === '`'`, filling each `${…}` with its sample.
 * A `${…}` can hold a nested template, so this tracks depth instead of using a regex.
 */
function readTemplate(src: string, i: number): [text: string, end: number] {
  let out = ''
  let j = i + 1
  while (j < src.length && src[j] !== '`') {
    if (src[j] === '\\') { out += src[j + 1]; j += 2; continue }
    if (src[j] === '$' && src[j + 1] === '{') {
      let depth = 1
      let k = j + 2
      while (k < src.length && depth > 0) {
        if (src[k] === '`') { k = readTemplate(src, k)[1]; continue }
        if (src[k] === '{') depth++
        else if (src[k] === '}') depth--
        k++
      }
      out += sample(src.slice(j + 2, k - 1))
      j = k
      continue
    }
    out += src[j]
    j++
  }
  return [out, j + 1]
}

/** Every string or template literal in `span`, with its placeholders filled. */
function literals(span: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < span.length) {
    const c = span[i]!
    let s: string | null = null
    if (c === '`') {
      const [text, end] = readTemplate(span, i)
      s = text
      i = end
    } else if (c === "'" || c === '"') {
      let j = i + 1
      let text = ''
      while (j < span.length && span[j] !== c) {
        if (span[j] === '\\') { text += span[j + 1]; j += 2; continue }
        text += span[j]
        j++
      }
      s = text
      i = j + 1
    } else {
      i++
      continue
    }
    // Prose, not an id or a key — and not a line of names and scores alone, which has no words to translate.
    const words = s.replace(/Team Seven/g, '').replace(/[^A-Za-z]/g, '')
    if (/^[A-Z0-9]/.test(s) && /\s/.test(s) && words.length > 0) out.push(s)
  }
  return out
}

/** The value text of each `key:` / `const key =` in `src`, up to the next property. */
function fieldSpans(src: string, keys: string[]): string[] {
  const lines = src.split('\n')
  const spans: string[] = []
  const start = new RegExp(`^\\s*(?:(?:${keys.join('|')})\\s*:|const (?:${keys.join('|')})\\s*=)`)
  for (let i = 0; i < lines.length; i++) {
    if (!start.test(lines[i]!)) continue
    let span = lines[i]!.replace(start, '')
    for (let j = i + 1; j < lines.length && /^\s*[?:]/.test(lines[j]!); j++) span += '\n' + lines[j]
    spans.push(span)
  }
  return spans
}

function section(src: string, from: string, to: string): string {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  expect(a, from).toBeGreaterThan(-1)
  expect(b, to).toBeGreaterThan(a)
  return src.slice(a, b)
}

const GEN_DIR = 'lib/shared-services/league-hub/generators/commissioner'

function cardSentences(): Record<string, string[]> {
  const generators = readdirSync(resolve(process.cwd(), GEN_DIR))
    .filter((f) => f.endsWith('Recommendations.ts'))
    .flatMap((f) => fieldSpans(read(`${GEN_DIR}/${f}`), ['title', 'summary']).flatMap(literals))

  const engine = section(read('lib/league-health/league-health-engine.ts'), 'const problems', 'const confidence')
  const healthEngine = [...engine.matchAll(/(?:problems|urgentAlerts|earlyWarnings|interventions)\.push\(([^\n]*)\)/g)]
    .flatMap((m) => literals(m[1]!))
    // a template built with `+` is reassembled from its pieces
    .concat([...engine.matchAll(/'(Zero trades through week )' \+ input\.currentWeek \+ '( — [^']*)'/g)].map((m) => `${m[1]}7${m[2]}`))
    .filter((s) => !s.startsWith('Zero trades through week ') || s.includes('7'))

  const attention = fieldSpans(
    section(read('lib/decision-os/attentionSignals.ts'), 'function draftApproachingSignal', 'function managerEngagementRiskSignal'),
    ['title', 'recommendedAction'],
  ).flatMap(literals)

  const drama = fieldSpans(read('lib/drama-engine/DramaEventDetector.ts'), ['headline', 'summary']).flatMap(literals)

  const service = fieldSpans(read('lib/shared-services/commissioner/LeagueHealthService.ts'), ['missingDataReason']).flatMap(literals)

  return { generators, healthEngine, attention, drama, service }
}

describe('commissionerOsText', () => {
  it('🛑 every sentence the four sources write for the card has Spanish', () => {
    const bySource = cardSentences()
    // The scan must see the real set, or an empty scan would pass.
    expect(bySource.generators.length).toBeGreaterThanOrEqual(15)
    expect(bySource.healthEngine.length).toBeGreaterThanOrEqual(12)
    expect(bySource.attention.length).toBeGreaterThanOrEqual(8)
    expect(bySource.drama.length).toBeGreaterThanOrEqual(18)
    expect(bySource.service.length).toBeGreaterThanOrEqual(1)

    const untranslated = Object.entries(bySource).flatMap(([source, list]) =>
      list.filter((s) => commissionerOsText(s, 'es') === s).map((s) => `${source}: ${s}`),
    )
    expect(untranslated).toEqual([])
  })

  it('keeps the names and numbers a template carries', () => {
    expect(commissionerOsText('Sparkle Motion is on a 4-game heater', 'es')).toBe('Sparkle Motion lleva una racha de 4 victorias')
    expect(commissionerOsText('Collapse warning: the Price i$ Right has dropped 3 straight', 'es')).toBe(
      'Alerta de derrumbe: the Price i$ Right ha perdido 3 seguidos',
    )
    expect(commissionerOsText('Major upset in week 3: Hoovi vs The Iceman Cometh ⛏️', 'es')).toBe(
      'Gran sorpresa en la semana 3: Hoovi vs The Iceman Cometh ⛏️',
    )
    expect(commissionerOsText('Possible integrity concern: 3 inactive managers — engagement at risk', 'es')).toBe(
      'Posible problema de integridad: 3 mánagers inactivos: la participación está en riesgo',
    )
    expect(commissionerOsText('Overall score 64/100 (stable). 1 issue(s) flagged.', 'es')).toBe(
      'Puntuación general 64/100 (estable). 1 problema detectado.',
    )
    expect(commissionerOsText('Most recent notable moment: h2h_matchup (2025).', 'es')).toBe(
      'Momento destacado más reciente: duelo directo (2025).',
    )
  })

  it('leaves English untouched and passes unknown text through', () => {
    expect(commissionerOsText('Review recommended', 'en')).toBe('Review recommended')
    expect(commissionerOsText('A sentence nobody wrote yet', 'es')).toBe('A sentence nobody wrote yet')
    expect(commissionerOsText(undefined, 'es')).toBe('')
  })
})

const payload = {
  bundle: {
    totalCount: 2,
    commissioner: [
      {
        id: 'a', domain: 'commissioner', type: 'mission_control_action', priority: 'high',
        title: 'ALERT: 30%+ of managers inactive. League may be dying.',
        summary: 'Flagged as urgent from this league’s health check.',
      },
      {
        id: 'b', domain: 'commissioner', type: 'storyline_win_streak', priority: 'low',
        title: 'Hoovi is on a 5-game heater', summary: 'Momentum continues to build as playoff pressure rises.',
        copyReadyContent: [{ channel: 'league_chat', text: 'Hoovi is on a 5-game heater', characterCount: 27, characterLimit: null, available: true }],
      },
    ],
  },
  domainStatus: { health: 'ok' },
  generatedAt: '2026-10-05T12:00:00.000Z',
}

describe('the Commissioner OS card follows en → es → en', () => {
  it('titles, summaries and the card’s own words — not the text the commissioner posts', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))))
    const { rerender } = render(<CommissionerOsActionsSummary leagueId="league-1" sport="NFL" />)
    expect(await screen.findByText('ALERT: 30%+ of managers inactive. League may be dying.')).toBeTruthy()
    expect(screen.getByText('1 urgent')).toBeTruthy()

    h.language = 'es'
    rerender(<CommissionerOsActionsSummary leagueId="league-1" sport="NFL" />)
    expect(screen.getByText('ALERTA: más del 30 % de los mánagers están inactivos. La liga podría estar muriendo.')).toBeTruthy()
    expect(screen.getByText('Marcado como urgente en la revisión de salud de esta liga.')).toBeTruthy()
    expect(screen.getByText('Hoovi lleva una racha de 5 victorias')).toBeTruthy()
    expect(screen.getByText('1 urgente')).toBeTruthy()
    expect(screen.getAllByText('Salud de la liga')).toHaveLength(2) // the area label and the domain chip
    expect(screen.getByText('Contenido listo para copiar')).toBeTruthy()
    expect(screen.getByText('Chat de la liga')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy()
    // The draft is the league's post, so it stays as written.
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Hoovi is on a 5-game heater')

    h.language = 'en'
    rerender(<CommissionerOsActionsSummary leagueId="league-1" sport="NFL" />)
    expect(screen.getByText('Hoovi is on a 5-game heater', { selector: 'p' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
  })
})

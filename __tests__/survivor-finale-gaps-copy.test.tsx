/**
 * Spanish for the finale Decision OS signals, the jury/finale line in Chimmy's commissioner report,
 * and the render of the new controls (final jury step, own-role note, rotate scene, rulebook row).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { deriveSurvivorFinaleSignals, type SurvivorFinaleSignalInputs } from '@/lib/decision-os/survivorFinaleSignals'
import { chimmyWeeklyReportBody, finaleReportLine } from '@/lib/survivor/chimmyWeeklyReport'
import { SurvivorFinaleControls } from '@/components/survivor/SurvivorFinaleControls'
import { SurvivorRulebook } from '@/components/core-app/survivor/SurvivorRulebook'
import { EMPTY_FINALE_WINDOWS, SURVIVOR_FINALE_DEFAULTS } from '@/lib/survivor/survivorFinaleSettings'
import { survivorFinaleMessages } from '@/lib/survivor/survivorFinaleMessages'
import { survivorIslandSettingsMessages } from '@/lib/core-app/messages/survivorIslandSettings'
import { missingMessages } from '@/lib/i18n/messages'

vi.mock('server-only', () => ({}))

afterEach(cleanup)

const NOW = new Date('2026-12-20T12:00:00Z')
const inH = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()
const everything: SurvivorFinaleSignalInputs = {
  leagueId: 'L1', now: NOW,
  questionsToAsk: 2, questionsDeadline: inH(5), questionWindowOpen: true,
  questionsToAnswer: 1, answersDeadline: inH(30), answerWindowOpen: true,
  speechMissing: true, speechesDeadline: inH(1), speechWindowOpen: true,
  ballotOwed: true, ballotsDueAt: inH(72),
}

describe('finale Decision OS signals in Spanish', () => {
  it('keeps English by default and words every title in Spanish for a Spanish league, same ids and severities', () => {
    const en = deriveSurvivorFinaleSignals(everything)
    const es = deriveSurvivorFinaleSignals({ ...everything, language: 'es' })
    expect(en.map((s) => s.title)).toEqual(['Jury question window closes in 5 h', 'Answer the jury — 30 h left', 'Write your closing speech — 1 h left', 'Votes due in 3 days'])
    expect(es.map((s) => s.title)).toEqual(['Las preguntas del jurado cierran en 5 h', 'Responde al jurado — quedan 30 h', 'Escribe tu discurso final — quedan 1 h', 'Los votos vencen en 3 días'])
    expect(es.map((s) => [s.id, s.type, s.severity])).toEqual(en.map((s) => [s.id, s.type, s.severity]))
    expect(es.every((s) => !/[A-Z][a-z]+ the /.test(s.explanation + s.recommendedAction))).toBe(true)
  })
})

describe("Chimmy's commissioner report: the finale line", () => {
  const p = { questionsAsked: 5, questionsAnswered: 3, speechesPosted: 1, finalists: 3, votesIn: 2, votesRequired: 6 }
  it('counts questions, answers, speeches and votes — never names — in EN and ES', () => {
    expect(finaleReportLine(p)).toBe('Finale: 5 jury questions asked, 3 answered; 1 of 3 closing speeches posted; 2 of 6 jury votes in.')
    expect(finaleReportLine({ ...p, questionsAsked: 1, questionsAnswered: 1 }, 'es')).toBe('Final: 1 pregunta del jurado, 1 respondida; 1 de 3 discursos finales publicados; 2 de 6 votos del jurado recibidos.')
  })
  it('rides at the end of the report, and stands alone when Chimmy runs no seat', () => {
    const rows = [{ name: 'Chimmy Seat', state: 'jury', voted: 0, exileTeam: null }]
    expect(chimmyWeeklyReportBody(17, rows, 'en', null, finaleReportLine(p)).split('\n').at(-1)).toMatch(/^Finale: /)
    expect(chimmyWeeklyReportBody(17, [], 'es', null, finaleReportLine(p, 'es'))).toBe(finaleReportLine(p, 'es'))
    expect(chimmyWeeklyReportBody(17, rows, 'en')).not.toContain('Finale:')
  })
})

describe('SurvivorFinaleControls: the final jury step and the own-role note', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const payload = (over: Record<string, unknown> = {}) => ({ settings: SURVIVOR_FINALE_DEFAULTS, windows: EMPTY_FINALE_WINDOWS, juryVoteDeadline: null, councilOpen: false, viewer: { role: 'playing_commissioner', canSeePrivateFinale: false }, jurySessionStatus: null, ...over })
  beforeEach(() => {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (!init?.method
      ? { ok: true, status: 200, json: async () => payload() }
      : { ok: true, status: 200, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('turns the step on with a count and saves only those keys', async () => {
    render(<SurvivorFinaleControls leagueId="L1" />)
    await waitFor(() => screen.getByTestId('survivor-finale-controls'))
    expect(screen.queryByTestId('finale-rule-juryStepCount')).toBeNull()
    fireEvent.click(screen.getByTestId('finale-rule-finalJuryStepEnabled'))
    fireEvent.change(screen.getByTestId('finale-rule-juryStepCount'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('finale-save-rules'))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(true))
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ leagueId: 'L1', action: 'finale_settings', settings: { finalJuryStepEnabled: true, finalJuryStepCount: 2 } })
  })

  it('locks the step once the finale has started, and tells a juror commissioner what they see', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => payload({ jurySessionStatus: 'questions_open', viewer: { role: 'juror', canSeePrivateFinale: false } }) }))
    render(<SurvivorFinaleControls leagueId="L1" />)
    await waitFor(() => screen.getByTestId('survivor-finale-controls'))
    expect((screen.getByTestId('finale-rule-finalJuryStepEnabled') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('finale-own-role-note').textContent).toBe(survivorFinaleMessages.en.ownRoleJuror)
    // The windows stay editable for them.
    expect((screen.getByTestId('finale-window-speechesDeadline') as HTMLInputElement).disabled).toBe(false)
  })

  it('has every new line in Spanish', () => {
    expect(missingMessages(survivorFinaleMessages, 'es')).toEqual([])
    expect(missingMessages(survivorIslandSettingsMessages, 'es')).toEqual([])
  })
})

describe('SurvivorRulebook: the vote row reads the settings-screen value', () => {
  it('shows the Tribal day from tribalVotesDue, not the stale columns', async () => {
    process.env.TZ = 'America/New_York'
    const config = { voteDeadlineDayOfWeek: 1, voteDeadlineTimeUtc: '15:00', selfVoteDisallowed: true, tribalVotesDue: { day: 'Thursday', timeEt: '20:00', hoursBefore: 0 } }
    const { container } = render(<SurvivorRulebook config={config} />)
    await waitFor(() => expect(container.querySelector('[data-rule="vote"] dd')?.textContent ?? '').toMatch(/Thursday/))
    expect(container.querySelector('[data-rule="vote"] dd')?.textContent).not.toMatch(/Monday/)
  })
})

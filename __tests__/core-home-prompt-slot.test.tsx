import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HomePromptSlot, useHomePromptTurn, type HomePromptId } from '@/components/core-app/HomePromptSlot'

/**
 * One optional prompt at a time on the /core home. Rendered through the real provider and
 * hook, with stand-in prompts whose "wants to show" state the test controls.
 */

const setters: Partial<Record<HomePromptId, (v: boolean) => void>> = {}

function Prompt({ id, initial }: { id: HomePromptId; initial: boolean }) {
  const [wants, setWants] = useState(initial)
  setters[id] = setWants
  const turn = useHomePromptTurn(id, wants)
  return turn ? <div data-testid="prompt">{id}</div> : null
}

function visible(): string[] {
  return screen.queryAllByTestId('prompt').map((el) => el.textContent ?? '')
}

describe('HomePromptSlot', () => {
  it('shows only the highest-priority prompt that wants to show, then the next once it is dismissed', async () => {
    render(
      <HomePromptSlot enabled>
        <Prompt id="sms-opt-in" initial />
        <Prompt id="game-day-alerts" initial />
        <Prompt id="welcome-tour" initial />
        <Prompt id="team-follow" initial={false} />
      </HomePromptSlot>,
    )
    expect(visible()).toEqual(['welcome-tour'])

    await act(async () => setters['welcome-tour']!(false))
    expect(visible()).toEqual(['game-day-alerts'])

    await act(async () => setters['game-day-alerts']!(false))
    expect(visible()).toEqual(['sms-opt-in'])
  })

  it('lets a newly-wanting higher-priority prompt take the slot', async () => {
    render(
      <HomePromptSlot enabled>
        <Prompt id="sms-opt-in" initial />
        <Prompt id="team-follow" initial={false} />
      </HomePromptSlot>,
    )
    expect(visible()).toEqual(['sms-opt-in'])
    await act(async () => setters['team-follow']!(true))
    expect(visible()).toEqual(['team-follow'])
  })

  it('grants every prompt when disabled, and outside any provider', () => {
    const { unmount } = render(
      <HomePromptSlot enabled={false}>
        <Prompt id="sms-opt-in" initial />
        <Prompt id="welcome-tour" initial />
      </HomePromptSlot>,
    )
    expect(visible().sort()).toEqual(['sms-opt-in', 'welcome-tour'])
    unmount()

    render(
      <>
        <Prompt id="sms-opt-in" initial />
        <Prompt id="game-day-alerts" initial />
      </>,
    )
    expect(visible().sort()).toEqual(['game-day-alerts', 'sms-opt-in'])
  })

  it('is wired into all four home prompts and the shell', () => {
    const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
    expect(read('components/core-app/CoreWelcomeTour.tsx')).toContain("useHomePromptTurn('welcome-tour', open)")
    expect(read('components/follows/TeamFollowPrompt.tsx')).toContain("useHomePromptTurn('team-follow', open)")
    expect(read('components/notifications/GameDayAlertsBanner.tsx')).toContain("useHomePromptTurn('game-day-alerts', show)")
    expect(read('components/notifications/SmsOptInCard.tsx')).toContain("useHomePromptTurn('sms-opt-in', show)")
    expect(read('components/core-app/AfCoreShell.tsx')).toContain("<HomePromptSlot enabled={active === 'home'}>")
  })
})

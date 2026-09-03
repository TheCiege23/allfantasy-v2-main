import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 120_000 })

async function gotoWithRetry(page: Page, url: string): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      return
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      const canRetry =
        attempt < 6 &&
        (
          message.includes('net::ERR_ABORTED') ||
          message.includes('NS_BINDING_ABORTED') ||
          message.includes('net::ERR_CONNECTION_RESET') ||
          message.includes('NS_ERROR_CONNECTION_REFUSED') ||
          message.includes('Failure when receiving data from the peer') ||
          message.includes('Could not connect to server') ||
          message.includes('interrupted by another navigation')
        )

      if (!canRetry) throw error
      await page.waitForTimeout(500 * attempt)
    }
  }
}

async function waitForShell(page: Page) {
  const shell = page.getByTestId('chimmy-harness-inline-shell')
  const routeWaiverButton = page.getByTestId('chimmy-harness-route-waiver-button')
  const input = shell.getByTestId('chimmy-message-input')

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (page.isClosed()) {
      throw new Error('Chimmy page closed before shell became interactive')
    }

    const notFoundVisible = await page
      .getByRole('heading', { name: 'This page could not be found.' })
      .isVisible()
      .catch(() => false)
    if (notFoundVisible) {
      await gotoWithRetry(page, '/e2e/chimmy-interface')
    }

    await routeWaiverButton.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => null)
    await routeWaiverButton.click({ force: true }).catch(() => null)
    await routeWaiverButton.evaluate((button) => (button as HTMLButtonElement).click()).catch(() => null)
    await page.waitForTimeout(300 * (attempt + 1)).catch(() => null)

    const shellVisible = await shell.getByTestId('chimmy-chat-shell').waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)
    const inputVisible = await input.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)
    if (shellVisible && inputVisible) return { shell, input }

    if (attempt >= 3) {
      await gotoWithRetry(page, '/e2e/chimmy-interface').catch(() => null)
    }
  }

  throw new Error('Chimmy shell never became interactive')
}

async function stubCommonRoutes(page: Page) {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'chimmy-voice-user',
          name: 'Chimmy Voice',
          email: 'chimmy.voice@example.com',
        },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    })
  })

  await page.route('**/api/auth/providers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  await page.route('**/api/auth/csrf', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'chimmy-voice-csrf' }),
    })
  })

  await page.route('**/api/auth/config-check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.route('**/api/auth/_log', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.route('**/api/ai/providers/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        openai: true,
        deepseek: true,
        grok: true,
        openclaw: true,
        openclawGrowth: true,
      }),
    })
  })
}

async function installSpeechHarness(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__speechTest = {
      audioPlayCalls: 0,
      audioPauseCalls: 0,
      audioSources: [] as string[],
      speechSynthesisCalls: 0,
      speechSynthesisCancels: 0,
      speechTexts: [] as string[],
      recognitionStarts: 0,
      recognitionStops: 0,
      lastTranscript: '',
    }

    let objectUrlId = 0
    const originalUrl = window.URL
    Object.defineProperty(window, 'URL', {
      configurable: true,
      value: class FakeURL extends originalUrl {
        static createObjectURL() {
          objectUrlId += 1
          return `blob:chimmy-${objectUrlId}`
        }

        static revokeObjectURL() {}
      },
    })

    class FakeAudio {
      src: string
      paused = true
      ended = false
      onended: ((event: Event) => void) | null = null
      onerror: ((event: Event) => void) | null = null

      constructor(src = '') {
        this.src = src
      }

      play() {
        ;(window as any).__speechTest.audioPlayCalls += 1
        ;(window as any).__speechTest.audioSources.push(this.src)
        this.paused = false
        this.ended = false

        setTimeout(() => {
          if (this.paused) return
          this.paused = true
          this.ended = true
          this.onended?.(new Event('ended'))
        }, 350)

        return Promise.resolve()
      }

      pause() {
        ;(window as any).__speechTest.audioPauseCalls += 1
        this.paused = true
      }
    }
    ;(window as any).Audio = FakeAudio

    class FakeSpeechSynthesisUtterance {
      text: string
      rate = 1
      pitch = 1
      volume = 1
      voice: SpeechSynthesisVoice | null = null
      onend: ((event: Event) => void) | null = null
      onerror: ((event: Event) => void) | null = null

      constructor(text: string) {
        this.text = text
      }
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FakeSpeechSynthesisUtterance,
    })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: false,
        pending: false,
        getVoices() {
          return [
            { name: 'Samantha', lang: 'en-US' },
            { name: 'Google US English', lang: 'en-US' },
          ]
        },
        cancel() {
          ;(window as any).__speechTest.speechSynthesisCancels += 1
          this.speaking = false
          this.pending = false
        },
        speak(utterance: InstanceType<typeof FakeSpeechSynthesisUtterance>) {
          ;(window as any).__speechTest.speechSynthesisCalls += 1
          ;(window as any).__speechTest.speechTexts.push(utterance.text)
          this.speaking = true
          this.pending = false
          setTimeout(() => {
            this.speaking = false
            utterance.onend?.(new Event('end'))
          }, 120)
        },
      },
    })

    class FakeSpeechRecognition {
      lang = 'en-US'
      interimResults = false
      continuous = false
      onstart: ((event: Event) => void) | null = null
      onend: ((event: Event) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onresult: ((event: { results: [[{ transcript: string }]] }) => void) | null = null

      start() {
        ;(window as any).__speechTest.recognitionStarts += 1
        this.onstart?.(new Event('start'))
        setTimeout(() => {
          ;(window as any).__speechTest.lastTranscript = 'voice input from test harness'
          this.onresult?.({
            results: [[{ transcript: 'voice input from test harness' }]],
          })
          this.onend?.(new Event('end'))
        }, 80)
      }

      stop() {
        ;(window as any).__speechTest.recognitionStops += 1
        this.onend?.(new Event('end'))
      }
    }

    ;(window as any).SpeechRecognition = FakeSpeechRecognition
    ;(window as any).webkitSpeechRecognition = FakeSpeechRecognition
  })
}

test.describe('@chimmy Chimmy voice coverage', () => {
  test('transcribes mic input and reads assistant replies aloud', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept())

    await installSpeechHarness(page)
    await stubCommonRoutes(page)

    await page.route('**/api/tokens/spend/preview?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          preview: {
            ruleCode: 'ai_chimmy_chat_message',
            featureLabel: 'Chimmy chat message',
            tokenCost: 1,
            currentBalance: 20,
            canSpend: true,
            requiresConfirmation: true,
          },
        }),
      })
    })

    /*
     * ⚠ `/api/tts` ANSWERS TWO DIFFERENT QUESTIONS AND THIS MOCK USED TO CONFLATE THEM.
     *
     * GET is a capability PROBE: ChimmyChatShell asks whether text-to-speech is
     * configured and requires `r.ok && data.available === true` from a JSON body.
     * POST is the synthesis call and returns audio bytes.
     *
     * Answering the GET with `audio/mpeg` made `r.json()` throw; the `.catch(() => null)`
     * swallowed it, `available` was never true, and the component set `ttsUnavailable`.
     * The voice toggle is `disabled={ttsUnavailable}` — so the spec disabled the very
     * button it then asserted was enabled, and the failure read as a broken product.
     *
     * Note the real handler would also say "no" here: it reports availability from
     * ELEVENLABS_API_KEY, which CI does not set. Voice is only testable behind a mock,
     * so the mock has to honour both halves of the contract.
     */
    const ttsBodies: Array<Record<string, unknown>> = []
    await page.route('**/api/tts', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, available: true }),
        })
        return
      }
      ttsBodies.push(route.request().postDataJSON() as Record<string, unknown>)
      await route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        body: 'FAKE_MP3_DATA',
      })
    })

    let chatCalls = 0
    await page.route('**/api/chimmy', async (route) => {
      chatCalls += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: `Calm response ${chatCalls}: Here is an evidence-first recommendation with risks and next step.`,
          meta: {
            confidencePct: 72,
            providerStatus: { openai: 'ok', grok: 'ok', deepseek: 'ok' },
            responseStructure: {
              shortAnswer: 'Hold for now unless you can improve WR floor.',
              whatDataSays: 'Projected weekly edge is +3.1 with moderate variance.',
              whatItMeans: 'This trade helps playoff ceiling but adds volatility.',
              recommendedAction: 'Counter with a safer WR2 tier add-on.',
              caveats: ['Projection confidence is medium this week.'],
            },
          },
        }),
      })
    })

    await gotoWithRetry(page, '/e2e/chimmy-interface')
    const { shell, input } = await waitForShell(page)
    await page.waitForTimeout(300)

    await expect(shell.getByTestId('chimmy-voice-toggle-button')).toBeEnabled()
    await expect(shell.getByTestId('chimmy-voice-choice-group')).toHaveCount(0)
    await expect(shell.getByTestId('chimmy-voice-input-button')).toBeEnabled()

    let micCapturedTranscript = false
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await shell.getByTestId('chimmy-voice-input-button').click()
      try {
        await expect
          .poll(
            async () => {
              const value = await input.inputValue()
              const transcriptRendered = await shell.getByText('voice input from test harness').count()
              return value.includes('voice input from test harness') || transcriptRendered > 0
            },
            { timeout: 5_000 }
          )
          .toBe(true)
        micCapturedTranscript = true
        break
      } catch (error) {
        if (attempt === 2) throw error
        await page.waitForTimeout(250)
      }
    }

    expect(micCapturedTranscript).toBe(true)

    const speechAfterMic = await page.evaluate(() => (window as any).__speechTest)
    expect(speechAfterMic.recognitionStarts).toBeGreaterThanOrEqual(1)
    expect(speechAfterMic.lastTranscript).toBe('voice input from test harness')

    const sendButton = shell.getByTestId('chimmy-send-button')
    const sendButtonEnabled = await sendButton.isEnabled()
    if (sendButtonEnabled) {
      await sendButton.click()
    }
    await expect.poll(() => chatCalls).toBeGreaterThanOrEqual(1)
    await expect(shell.getByTestId('chimmy-response-structure').last()).toBeVisible()

    await expect
      .poll(async () => {
        const state = await page.evaluate(() => (window as any).__speechTest)
        return state.audioPlayCalls
      })
      .toBe(0)

    const listenButton = shell.getByTestId('chimmy-play-voice-button').last()
    await expect(listenButton).toBeEnabled()
    await listenButton.click()

    await expect
      .poll(async () => {
        const state = await page.evaluate(() => (window as any).__speechTest)
        return state.audioPlayCalls
      })
      .toBeGreaterThanOrEqual(1)

    const speechAfterManualPlay = await page.evaluate(() => (window as any).__speechTest)
    expect(speechAfterManualPlay.audioSources[0]).toContain('blob:chimmy-')
    expect(ttsBodies.some((body) => String(body?.text ?? '').includes('Calm response'))).toBe(true)

    const pauseCallsBeforeStop = await page.evaluate(() => (window as any).__speechTest.audioPauseCalls)
    const stopButton = shell.getByTestId('chimmy-voice-stop-button')
    await expect(stopButton).toBeVisible()
    await stopButton.click()

    await expect
      .poll(async () => {
        const state = await page.evaluate(() => (window as any).__speechTest)
        return state.audioPauseCalls
      })
      .toBeGreaterThan(pauseCallsBeforeStop)
  })

  test('disables voice controls when browser speech APIs are unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).Audio = undefined
      Object.defineProperty(window.URL, 'createObjectURL', {
        configurable: true,
        value: undefined,
      })
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: undefined,
      })
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        configurable: true,
        value: undefined,
      })
      ;(window as any).SpeechRecognition = undefined
      ;(window as any).webkitSpeechRecognition = undefined
    })

    await stubCommonRoutes(page)
    await gotoWithRetry(page, '/e2e/chimmy-interface')
    const { shell } = await waitForShell(page)

    await expect(shell.getByTestId('chimmy-voice-toggle-button')).toBeDisabled()
    await expect(shell.getByTestId('chimmy-voice-input-button')).toBeDisabled()
    await expect(shell.getByTestId('chimmy-voice-choice-group')).toHaveCount(0)
    await expect(shell.getByRole('button', { name: /voice unavailable/i })).toBeVisible()
    await expect(shell.getByText('Mic unavailable')).toBeVisible()
  })

  test('shows voice unavailable guidance when server TTS is unavailable', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept())

    await installSpeechHarness(page)
    await stubCommonRoutes(page)

    await page.route('**/api/tokens/spend/preview?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          preview: {
            ruleCode: 'ai_chimmy_chat_message',
            featureLabel: 'Chimmy chat message',
            tokenCost: 1,
            currentBalance: 20,
            canSpend: true,
            requiresConfirmation: true,
          },
        }),
      })
    })

    await page.route('**/api/tts', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'X-Chimmy-TTS-Fallback': 'browser',
        },
        body: JSON.stringify({
          error: 'TTS not configured',
        }),
      })
    })

    await page.route('**/api/chimmy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response:
            'Recommendation: REJECT this trade. CeeDee Lamb is six years younger and still gives you the better dynasty insulation.',
          meta: {
            responseStructure: {
              shortAnswer: 'Reject this trade.',
              recommendedAction: 'Recommendation: REJECT this trade.',
            },
          },
        }),
      })
    })

    await gotoWithRetry(page, '/e2e/chimmy-interface')
    const { shell, input } = await waitForShell(page)
    await input.fill('Should I do this trade?')
    await expect
      .poll(async () => shell.getByTestId('chimmy-send-button').isEnabled().catch(() => false), { timeout: 20_000 })
      .toBe(true)
    await shell.getByTestId('chimmy-send-button').click()
    await expect(shell.getByTestId('chimmy-response-structure').last()).toBeVisible()

    await expect
      .poll(async () => {
        const state = await page.evaluate(() => (window as any).__speechTest)
        return state.speechSynthesisCalls
      })
      .toBe(0)

    await shell.getByTestId('chimmy-play-voice-button').last().click()

    await expect
      .poll(async () => {
        const state = await page.evaluate(() => (window as any).__speechTest)
        return state.speechSynthesisCalls
      })
      .toBe(0)

    const fallbackState = await page.evaluate(() => (window as any).__speechTest)
    await expect(shell.getByText(/voice unavailable/i)).toBeVisible()
    expect(Array.isArray(fallbackState.speechTexts)).toBe(true)
    expect(fallbackState.audioPlayCalls).toBe(0)
  })
})

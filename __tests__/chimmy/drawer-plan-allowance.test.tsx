import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const consent = vi.hoisted(() => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('@/lib/tokens/client-confirm', () => consent)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

/**
 * AF Pro includes Chimmy, 100 answers a day. A subscriber must SEE that — before asking, instead of a
 * token price they will not pay, and under each answer as the count moves.
 */

const ALLOWANCE = { included: true, planName: 'AF Pro', used: 0, limit: 100, resetsAt: '2026-09-25T00:00:00.000Z' }

describe('Chimmy drawer — plan allowance', () => {
  beforeEach(() => {
    sessionStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url) === '/api/chat/chimmy'
          ? {
              ok: true,
              status: 200,
              json: async () => ({
                response: 'Start Jayden Reed.',
                meta: { planAllowance: { ...ALLOWANCE, used: 37 } },
              }),
            }
          : { ok: true, status: 200, json: async () => ({}) },
      ),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  function open(allowance: typeof ALLOWANCE | null) {
    render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={[{ id: 'l0', name: 'KBFL', platform: 'sleeper' }] as never}
        pageLeagueId={null}
        chimmyTokenCost={10}
        chimmyPlanAllowance={allowance}
        initialTab="chimmy"
        userId="u1"
      />,
    )
  }

  it('tells a subscriber what is included instead of quoting a token price', () => {
    open(ALLOWANCE)
    expect(screen.getByText('Included with AF Pro: 100 of 100 Chimmy answers left today. After that, answers cost 10 tokens.')).toBeTruthy()
    expect(screen.queryByText(/may cost 10 tokens/)).toBeNull()
  })

  it('still quotes the price to everyone else', () => {
    open(null)
    expect(
      screen.getByText(
        "Free summaries and lookups cost nothing. Detailed answers use your daily allowance first; review the price before spending tokens.",
      ),
    ).toBeTruthy()
  })

  it('marks an included answer and moves the count, with no consent prompt', async () => {
    open(ALLOWANCE)
    const box = screen.getByLabelText('Message') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'Set my best lineup' } })
    fireEvent.submit(box.closest('form') as HTMLFormElement)
    expect(await screen.findByText('Included with AF Pro · 37 of 100 today')).toBeTruthy()
    expect(screen.getByText('Included with AF Pro: 63 of 100 Chimmy answers left today. After that, answers cost 10 tokens.')).toBeTruthy()
    expect(consent.confirmTokenSpend).not.toHaveBeenCalled()
  })
  it('shows the screenshot before sending and retains its preview in the sent turn', async () => {
    open(ALLOWANCE)
    const file = new File(['image-content'], 'offer.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"][accept*="image/png"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByAltText('Attached screenshot preview')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Send to Chimmy'))
    expect(await screen.findByAltText('Screenshot: offer.png')).toBeTruthy()
    await screen.findByText('Start Jayden Reed.')
    const request = vi.mocked(fetch).mock.calls.find(c => c[0] === '/api/chat/chimmy')
    const posted = (request?.[1] as RequestInit).body as FormData
    expect(posted.get('image')).toBe(file)
  })
  it('keeps the free preview until explicit unlock and reuses its exact question and request', async () => {
    const preview={version:1,summary:'Check availability before kickoff.',sections:[{title:'Reasoning',description:'Available evidence'}],access:'tokens',tokenCost:3,currentBalance:10,canUnlock:true,quote:'signed-quote',expiresAt:'2026-10-25T23:00:00Z'}
    const posted:FormData[]=[]
    vi.stubGlobal('fetch',vi.fn(async (url,init) => {
      if(url!=='/api/chat/chimmy') return new Response('{}')
      const form=(init as RequestInit).body as FormData; const copy=new FormData();for(const [key,value] of form.entries())copy.append(key,value);posted.push(copy)
      return posted.length===1 ? new Response(JSON.stringify({code:'token_confirmation_required',analysisPreview:preview}),{status:409}) : new Response(JSON.stringify({response:'Full detailed answer.',meta:{tokenSpend:{tokenCost:3}}}))
    }))
    open(null);const box=screen.getByLabelText('Message');fireEvent.change(box,{target:{value:'Analyze my options'}});fireEvent.submit(box.closest('form')!)
    const button=await screen.findByRole('button',{name:'Unlock extra detail · 3 tokens'});expect(screen.getByText(preview.summary)).toBeVisible();expect(posted).toHaveLength(1);expect(consent.confirmTokenSpend).not.toHaveBeenCalled()
    fireEvent.click(button);expect(await screen.findByText('Full detailed answer.')).toBeVisible();expect(posted).toHaveLength(2)
    expect(posted[1].get('requestId')).toBe(posted[0].get('requestId'));expect(posted[1].get('conversation')).toBe(posted[0].get('conversation'));expect(posted[1].get('message')).toBe('Analyze my options');expect(posted[1].get('tokenQuote')).toBe('signed-quote');expect(posted[1].get('confirmTokenSpend')).toBe('true')
    expect(screen.queryByTestId('chimmy-analysis-preview')).toBeNull();expect(screen.getAllByText('Analyze my options')).toHaveLength(1)
  })
  it('does not describe a free short engine answer as spending tokens after the allowance is used', async () => {
    vi.stubGlobal('fetch',vi.fn(async url => url==='/api/chat/chimmy' ? new Response(JSON.stringify({response:'Short complete engine answer.',meta:{free:true,mode:'fast_take',tokenSpend:null,planAllowance:{kind:'free',included:false,planName:'Free Chimmy',used:2,limit:2,resetsAt:'2026-10-26T00:00:00Z'}}})) : new Response('{}')))
    open(null);const box=screen.getByLabelText('Message');fireEvent.change(box,{target:{value:'Give the short answer'}});fireEvent.submit(box.closest('form')!)
    await screen.findByText('Short complete engine answer.')
    expect(screen.getByText('Not charged')).toBeTruthy()
    expect(screen.queryByText(/this answer used tokens/)).toBeNull()
  })

})

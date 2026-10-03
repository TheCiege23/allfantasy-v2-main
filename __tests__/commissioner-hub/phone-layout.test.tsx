import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { HubSwitcher } from '@/components/core-app/hubs/HubSwitcher'
import { TaskCards } from '@/components/core-app/commissioner/HubSections'

afterEach(cleanup)

const counts = { zombie: 0, tournament: 1, survivor: 0, c2c: 0, guillotine: 2, efl: 0 }

describe('HubSwitcher marks formats the reader has no league of', () => {
  it('marks zero-count formats, not counted ones, and never the open hub', () => {
    const { container } = render(<HubSwitcher current="survivor" counts={counts} runCount={5} />)
    const empty = [...container.querySelectorAll('a[data-empty="true"]')].map((a) => a.getAttribute('href'))
    expect(empty).toEqual(['/core/hubs/zombie', '/core/hubs/c2c', '/core/hubs/efl'])
    // Every pill is still in the DOM — desktop shows them all; only the phone hides the marked ones.
    expect(container.querySelectorAll('a')).toHaveLength(7)
  })
})

function card(i: number) {
  return { id: `t${i}`, severity: 'warn' as const, source: 'health' as const, title: `Task ${i}`, detail: 'd', due: null, action: null }
}
function hub(cards: number, overflow: number) {
  return {
    tasks: {
      cards: Array.from({ length: cards }, (_, i) => card(i + 1)),
      overflow: Array.from({ length: overflow }, (_, i) => card(cards + i + 1)),
    },
    tasksEmptyReason: 'Nothing to do.',
  } as never
}
const titles = (el: Element | null) => [...(el?.querySelectorAll('.af-ch-task-title') ?? [])].map((p) => p.textContent)

describe('TaskCards: three on a phone, the rest behind "more"', () => {
  it('splits six cards into a first three and a wide-only three, and repeats those three inside "more" for phones', () => {
    const { container } = render(<TaskCards data={hub(6, 2)} />)
    const lists = [...container.querySelectorAll('ul.af-ch-tasks')]
    expect(titles(lists[0])).toEqual(['Task 1', 'Task 2', 'Task 3'])
    expect(titles(container.querySelector('.af-ch-tasks--wide-only'))).toEqual(['Task 4', 'Task 5', 'Task 6'])
    const more = container.querySelector('details.af-ch-more')!
    expect(titles(more.querySelector('.af-ch-tasks--phone-only'))).toEqual(['Task 4', 'Task 5', 'Task 6'])
    expect(more.querySelector('.af-ch-more-wide')?.textContent).toBe('2 more tasks')
    expect(more.querySelector('.af-ch-more-phone')?.textContent).toBe('5 more tasks')
    expect(more.hasAttribute('data-wide-empty')).toBe(false)
  })

  it('offers a phone-only "more" when there is no overflow beyond the grid', () => {
    const { container } = render(<TaskCards data={hub(4, 0)} />)
    const more = container.querySelector('details.af-ch-more')!
    expect(more.getAttribute('data-wide-empty')).toBe('true')
    expect(more.querySelector('.af-ch-more-phone')?.textContent).toBe('1 more task')
  })

  it('draws no "more" at all for three cards or fewer', () => {
    const { container } = render(<TaskCards data={hub(3, 0)} />)
    expect(container.querySelector('details.af-ch-more')).toBeNull()
    expect(container.querySelector('.af-ch-tasks--wide-only')).toBeNull()
  })
})

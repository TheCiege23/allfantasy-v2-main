// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { setImmediate } from 'node:timers/promises'
import { cooperativeMap } from '../lib/async-cooperative-map'

describe('cooperativeMap', () => {
  it('lets queued I/O run before a large transform completes, preserving order and indexes', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
    let completed = false
    let servicedBeforeCompletion = false
    const heartbeat = setImmediate().then(() => { servicedBeforeCompletion = !completed })
    const result = await cooperativeMap(rows, (row, index) => `${row.id}:${index}`)
    completed = true
    await heartbeat
    expect(servicedBeforeCompletion).toBe(true)
    expect(result).toEqual(rows.map((row, index) => `${row.id}:${index}`))
  })

  it('propagates errors and does not transform later rows', async () => {
    const visited: number[] = []
    await expect(cooperativeMap([1, 2, 3], value => {
      visited.push(value)
      if (value === 2) throw new Error('bad row')
      return value
    })).rejects.toThrow('bad row')
    expect(visited).toEqual([1, 2])
    expect(await cooperativeMap([], value => value)).toEqual([])
  })
})

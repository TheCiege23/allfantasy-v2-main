// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

// The module binds its default observer to the real SDK at import time; these tests drive
// `createDbObserver` with a fake span API instead, so the SDK import is stubbed to stay inert.
vi.mock('@sentry/nextjs', () => ({
  getActiveSpan: () => undefined,
  getRootSpan: (span: unknown) => span,
  withActiveSpan: (_span: unknown, callback: () => unknown) => callback(),
  startInactiveSpan: () => ({}),
}))

import {
  createDbObserver,
  failureLabel,
  observeDbOperation,
  type SpanApi,
  type SpanLike,
} from '@/lib/observability/dbTelemetry'

class FakeSpan implements SpanLike {
  attributes: Record<string, unknown> = {}
  status: { code: number; message?: string } | undefined
  endedAt: number | undefined
  constructor(
    readonly name: string,
    private readonly recording = true,
  ) {}
  isRecording() {
    return this.recording
  }
  setAttributes(attributes: Record<string, unknown>) {
    Object.assign(this.attributes, attributes)
  }
  setStatus(status: { code: number; message?: string }) {
    this.status = status
  }
  end(endTimestamp?: number) {
    this.endedAt = endTimestamp
  }
}

function harness(options: { active?: FakeSpan; root?: FakeSpan; slowQueryMs?: number; maxSlowSpansPerRoot?: number } = {}) {
  const root = options.root ?? new FakeSpan('GET /core/[[...screen]]')
  const active = 'active' in options ? options.active : new FakeSpan('function.nextjs')
  let monotonic = 5_000
  let epoch = 1_788_000_000_000
  const started: Array<{ options: Parameters<SpanApi['startInactiveSpan']>[0]; parent: SpanLike | undefined; span: FakeSpan }> = []
  let current: SpanLike | undefined = active
  const api: SpanApi = {
    getActiveSpan: () => current,
    getRootSpan: () => root,
    withActiveSpan: (span, callback) => {
      const previous = current
      current = span
      try {
        return callback()
      } finally {
        current = previous
      }
    },
    startInactiveSpan: (spanOptions) => {
      const span = new FakeSpan(spanOptions.name)
      started.push({ options: spanOptions, parent: current, span })
      return span
    },
  }
  const observe = createDbObserver(api, {
    slowQueryMs: options.slowQueryMs ?? 100,
    maxSlowSpansPerRoot: options.maxSlowSpansPerRoot ?? 20,
    monotonicMs: () => monotonic,
    epochMs: () => epoch,
  })
  /** An operation that "takes" `ms` on both clocks. */
  const takes = <T>(ms: number, value: T) => async () => {
    monotonic += ms
    epoch += ms
    return value
  }
  return { api, root, active, started, observe, takes }
}

describe('createDbObserver — per-request totals on the root span', () => {
  it('accumulates count, database time, the slowest operation and errors', async () => {
    const h = harness()
    await h.observe({ model: 'League', operation: 'findMany' }, h.takes(12, []))
    await h.observe({ model: 'LeagueTeam', operation: 'findMany' }, h.takes(40, []))
    await h.observe({ model: 'User', operation: 'findUnique' }, h.takes(8, null))

    expect(h.root.attributes).toEqual({
      'af.db.count': 3,
      'af.db.ms': 60,
      'af.db.max_ms': 40,
      'af.db.slowest': 'LeagueTeam.findMany',
      'af.db.errors': 0,
    })
    expect(h.started).toHaveLength(0) // nothing crossed the slow threshold
  })

  it('names a raw query by its operation', async () => {
    const h = harness()
    await h.observe({ model: undefined, operation: '$queryRaw' }, h.takes(5, []))
    expect(h.root.attributes['af.db.slowest']).toBe('$queryRaw')
  })

  it('returns the operation’s own result untouched', async () => {
    const h = harness()
    const rows = [{ id: 'a' }]
    await expect(h.observe({ model: 'League', operation: 'findMany' }, h.takes(3, rows))).resolves.toBe(rows)
  })
})

describe('createDbObserver — slow operations become child spans', () => {
  it('creates the span after the fact, under the span that was active, with its true start and end', async () => {
    const h = harness()
    const epochAtStart = 1_788_000_000_000
    await h.observe({ model: 'WeeklyMatchup', operation: 'findMany' }, h.takes(250, []))

    expect(h.started).toHaveLength(1)
    const [{ options, parent, span }] = h.started
    expect(parent).toBe(h.active)
    expect(options).toMatchObject({
      name: 'WeeklyMatchup.findMany',
      op: 'db.prisma',
      onlyIfParent: true,
      startTime: epochAtStart / 1000,
      attributes: { 'db.system': 'postgresql', 'db.operation.name': 'findMany', 'db.collection.name': 'WeeklyMatchup' },
    })
    expect(span.endedAt).toBe((epochAtStart + 250) / 1000)
  })

  it('caps slow spans per request while the totals keep counting', async () => {
    const h = harness({ maxSlowSpansPerRoot: 2 })
    for (let i = 0; i < 4; i++) await h.observe({ model: 'Roster', operation: 'findMany' }, h.takes(150, []))
    expect(h.started).toHaveLength(2)
    expect(h.root.attributes['af.db.count']).toBe(4)
    expect(h.root.attributes['af.db.ms']).toBe(600)
  })

  it('marks a failed slow operation and rethrows the ORIGINAL error', async () => {
    const h = harness()
    const original = new Error('P2024: timed out fetching a connection')
    const failing = async () => {
      await h.takes(300, null)()
      throw original
    }
    await expect(h.observe({ model: 'League', operation: 'findFirst' }, failing)).rejects.toBe(original)
    expect(h.root.attributes['af.db.errors']).toBe(1)
    expect(h.started[0].span.status).toEqual({ code: 2, message: 'internal_error' })
  })
})

/** An error shaped like Prisma's `PrismaClientKnownRequestError`. */
function prismaError(code: string, message: string) {
  return Object.assign(new Error(message), { name: 'PrismaClientKnownRequestError', code })
}

describe('createDbObserver — failed operations are NAMED, not just counted', () => {
  const fail = (h: ReturnType<typeof harness>, ms: number, error: unknown) => async () => {
    await h.takes(ms, null)()
    throw error
  }

  /**
   * 🛑 THE CASE THAT WAS INVISIBLE. Production /core home renders counted 40 failures in 25 renders
   * with nothing to say which query failed, because only a failure that was also SLOW became a
   * span. A missing table fails in milliseconds.
   */
  it('gives a FAST failure its own span, marked as an error and labelled with its code', async () => {
    const h = harness()
    const original = prismaError('P2021', 'The table `public.player_follows` does not exist')
    await expect(h.observe({ model: 'PlayerFollow', operation: 'findMany' }, fail(h, 4, original))).rejects.toBe(original)

    expect(h.started).toHaveLength(1)
    const [{ options, span }] = h.started
    expect(options.name).toBe('PlayerFollow.findMany')
    expect(options.attributes).toMatchObject({ 'af.db.error': 'P2021' })
    expect(options.attributes).not.toHaveProperty('af.db.slow')
    expect(span.status).toEqual({ code: 2, message: 'internal_error' })
    expect(span.endedAt).toBe((1_788_000_000_000 + 4) / 1000)
  })

  it('lists each distinct failing operation on the root, in the order first seen', async () => {
    const h = harness()
    const timeout = prismaError('P2024', 'Timed out fetching a new connection from the connection pool')
    await h.observe({ model: 'SportsDataCache', operation: 'findUnique' }, fail(h, 2, timeout)).catch(() => {})
    await h.observe({ model: 'League', operation: 'findMany' }, h.takes(3, []))
    await h.observe({ model: 'TokenSpendRule', operation: 'upsert' }, fail(h, 2, prismaError('P2002', 'x'))).catch(() => {})
    // The same operation failing the same way again is counted, not listed twice.
    await h.observe({ model: 'SportsDataCache', operation: 'findUnique' }, fail(h, 2, timeout)).catch(() => {})

    expect(h.root.attributes['af.db.errors']).toBe(3)
    expect(h.root.attributes['af.db.error_ops']).toBe('SportsDataCache.findUnique:P2024,TokenSpendRule.upsert:P2002')
  })

  it('stops growing the list at eight entries while the count keeps going', async () => {
    const h = harness({ maxSlowSpansPerRoot: 0 })
    for (let i = 0; i < 12; i++) {
      await h.observe({ model: `Model${i}`, operation: 'findMany' }, fail(h, 1, prismaError('P2021', 'x'))).catch(() => {})
    }
    expect(h.root.attributes['af.db.errors']).toBe(12)
    expect(String(h.root.attributes['af.db.error_ops']).split(',')).toHaveLength(8)
  })

  it('adds no error attribute to a request where nothing failed', async () => {
    const h = harness()
    await h.observe({ model: 'League', operation: 'findMany' }, h.takes(3, []))
    expect(h.root.attributes).not.toHaveProperty('af.db.error_ops')
  })

  it('caps failure spans separately, so slow successes cannot use up the budget that names failures', async () => {
    const h = harness({ maxSlowSpansPerRoot: 1, slowQueryMs: 100 })

    await h.observe({ model: 'Roster', operation: 'findMany' }, h.takes(500, [])) // uses the only slow slot
    await h.observe({ model: 'Roster', operation: 'findMany' }, h.takes(500, [])) // over the slow cap: no span
    await h.observe({ model: 'Roster', operation: 'count' }, fail(h, 5, prismaError('P2024', 'x'))).catch(() => {})

    expect(h.started.map((s) => s.options.name)).toEqual(['Roster.findMany', 'Roster.count'])
    expect(h.started[1].span.status).toEqual({ code: 2, message: 'internal_error' })
  })

  it('stops creating failure spans at its own cap', async () => {
    const root = new FakeSpan('GET /core')
    let current: SpanLike | undefined = new FakeSpan('function.nextjs')
    const started: string[] = []
    const api: SpanApi = {
      getActiveSpan: () => current,
      getRootSpan: () => root,
      withActiveSpan: (span, callback) => {
        const previous = current
        current = span
        try {
          return callback()
        } finally {
          current = previous
        }
      },
      startInactiveSpan: (options) => {
        started.push(options.name)
        return new FakeSpan(options.name)
      },
    }
    let clock = 0
    const observe = createDbObserver(api, {
      slowQueryMs: 100,
      maxSlowSpansPerRoot: 20,
      maxErrorSpansPerRoot: 2,
      monotonicMs: () => clock,
      epochMs: () => clock,
    })
    for (let i = 0; i < 5; i++) {
      await observe({ model: 'League', operation: `op${i}` }, async () => {
        clock += 3
        throw prismaError('P2024', 'x')
      }).catch(() => {})
    }
    expect(started).toEqual(['League.op0', 'League.op1'])
    expect(root.attributes['af.db.errors']).toBe(5)
  })
})

describe('failureLabel — a code or a class name, never the message', () => {
  it('prefers a Prisma error code', () => {
    expect(failureLabel(prismaError('P2024', 'Timed out fetching a new connection'))).toBe('P2024')
  })

  /**
   * 🛑 A Prisma message can quote the values that violated a constraint. Nothing from the message
   * may reach a span attribute, however it is shaped.
   */
  it('never returns any part of the message', () => {
    const leaky = prismaError('P2002', 'Unique constraint failed on the fields: (`email`) value alice@example.com')
    expect(failureLabel(leaky)).toBe('P2002')
    expect(failureLabel(new Error('alice@example.com'))).toBe('Error')
    expect(failureLabel(Object.assign(new Error('x'), { code: 'alice@example.com' }))).toBe('Error')
    /* The fallback path: no code, no usable class name, and a message that must not come through. */
    const nameless = Object.assign(new Error('alice@example.com'), { name: '' })
    expect(failureLabel(nameless)).toBe('Error')
    expect(failureLabel({ message: 'alice@example.com' })).toBe('Error')
  })

  it('falls back to the class name for an error without a Prisma code', () => {
    const unknown = Object.assign(new Error('boom'), { name: 'PrismaClientUnknownRequestError' })
    expect(failureLabel(unknown)).toBe('PrismaClientUnknownRequestError')
    expect(failureLabel(new TypeError('bad'))).toBe('TypeError')
  })

  it('collapses anything that is not a plausible class name to "Error"', () => {
    expect(failureLabel(Object.assign(new Error('x'), { name: 'name with spaces and alice@example.com' }))).toBe('Error')
    expect(failureLabel('a thrown string')).toBe('Error')
    expect(failureLabel(null)).toBe('Error')
    expect(failureLabel(undefined)).toBe('Error')
    expect(failureLabel({ code: 42 })).toBe('Error')
  })
})

describe('createDbObserver — costs nothing when there is nothing to record', () => {
  it('runs the operation directly when no span is active', async () => {
    const h = harness({ active: undefined })
    const getRootSpan = vi.spyOn(h.api, 'getRootSpan')
    await expect(h.observe({ model: 'League', operation: 'count' }, h.takes(500, 7))).resolves.toBe(7)
    expect(getRootSpan).not.toHaveBeenCalled()
    expect(h.started).toHaveLength(0)
  })

  it('writes nothing for an unsampled request', async () => {
    const h = harness({ root: new FakeSpan('GET /core', false) })
    await h.observe({ model: 'League', operation: 'findMany' }, h.takes(500, []))
    expect(h.root.attributes).toEqual({})
    expect(h.started).toHaveLength(0)
  })
})

describe('createDbObserver — telemetry never breaks a query', () => {
  it('returns the result when the span API throws while recording', async () => {
    const h = harness()
    h.api.getRootSpan = () => {
      throw new Error('sdk exploded')
    }
    await expect(h.observe({ model: 'League', operation: 'findMany' }, h.takes(5, 'rows'))).resolves.toBe('rows')
  })

  it('surfaces the operation’s error, not a telemetry error, when both fail', async () => {
    const h = harness()
    h.api.getRootSpan = () => {
      throw new Error('sdk exploded')
    }
    const original = new Error('unique constraint')
    await expect(
      h.observe({ model: 'League', operation: 'create' }, async () => {
        throw original
      }),
    ).rejects.toBe(original)
  })

  it('treats a throwing getActiveSpan as "no span"', async () => {
    const h = harness()
    h.api.getActiveSpan = () => {
      throw new Error('no context manager')
    }
    await expect(h.observe({ model: 'League', operation: 'findMany' }, h.takes(5, 'rows'))).resolves.toBe('rows')
  })
})

describe('observeDbOperation (bound to the SDK)', () => {
  it('is a transparent passthrough outside a traced request', async () => {
    await expect(observeDbOperation({ model: 'League', operation: 'findMany' }, async () => 'rows')).resolves.toBe('rows')
  })
})

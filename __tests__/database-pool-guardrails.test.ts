import { describe, expect, it } from 'vitest'
import { applyDatabasePoolGuardrails } from '../lib/env/database-pool'

describe('Prisma process pool guardrails', () => {
  it('bounds pooled and direct PostgreSQL URLs without changing connection identity or SSL', () => {
    for (const host of ['example-pooler.invalid', 'example.invalid']) {
      const before = new URL(`postgresql://test:escaped%40password@${host}:5432/fantasy?sslmode=require&application_name=trade-os`)
      const after = new URL(applyDatabasePoolGuardrails(before.toString()))
      expect(after.searchParams.get('connection_limit')).toBe('5')
      expect(after.searchParams.get('pool_timeout')).toBe('30')
      after.searchParams.delete('connection_limit')
      after.searchParams.delete('pool_timeout')
      expect(after.toString()).toBe(before.toString())
    }
  })
  it('preserves explicit pool settings, including a disabled timeout', () => {
    const url = 'postgres://test:test@example.invalid/fantasy?connection_limit=12&pool_timeout=0'
    expect(applyDatabasePoolGuardrails(url)).toBe(url)
  })
  it('adds only the missing setting and is idempotent', () => {
    const result = applyDatabasePoolGuardrails('postgres://test:test@example.invalid/fantasy?connection_limit=3')
    expect(new URL(result).searchParams.get('connection_limit')).toBe('3')
    expect(new URL(result).searchParams.get('pool_timeout')).toBe('30')
    expect(applyDatabasePoolGuardrails(result)).toBe(result)
  })
  it('leaves other connectors and invalid URLs untouched', () => {
    for (const url of ['prisma://accelerate.invalid/?api_key=test', 'file:./dev.db', 'mysql://test:test@example.invalid/db', 'postgresql://']) {
      expect(applyDatabasePoolGuardrails(url)).toBe(url)
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
const { recoverIdenticalEngineCopy } = require('../scripts/prisma-identical-engine-copy.cjs')
const target = path.resolve('node_modules/.prisma/client/query_engine-windows.dll.node')
describe('locked identical Prisma engine recovery', () => {
  it('accepts identical bytes without replacing the loaded DLL', async () => {
    const io = { readFile: vi.fn().mockResolvedValue(Buffer.from('same')), unlink: vi.fn() }
    expect(await recoverIdenticalEngineCopy(`${target}.tmp123`, target, { code: 'EPERM' }, io)).toBe(true)
    expect(io.unlink).toHaveBeenCalledWith(`${target}.tmp123`)
  })
  it('refuses a different engine version', async () => {
    const io = { readFile: vi.fn().mockResolvedValueOnce(Buffer.from('new')).mockResolvedValueOnce(Buffer.from('old')), unlink: vi.fn() }
    expect(await recoverIdenticalEngineCopy(`${target}.tmp123`, target, { code: 'EPERM' }, io)).toBe(false)
    expect(io.unlink).not.toHaveBeenCalled()
  })
  it('never handles an unrelated file or error', async () => {
    const io = { readFile: vi.fn(), unlink: vi.fn() }
    expect(await recoverIdenticalEngineCopy('other.tmp123', 'other', { code: 'EPERM' }, io)).toBe(false)
    expect(await recoverIdenticalEngineCopy(`${target}.tmp123`, target, { code: 'ENOSPC' }, io)).toBe(false)
    expect(io.readFile).not.toHaveBeenCalled()
  })
})

/**
 * The secret scan's tracked-.env listing must survive a file list larger than Node's default 1 MiB
 * `maxBuffer`. It did not: on 2026-10-22 `git ls-files -z` reached ~1,048,800 bytes, execFileSync threw,
 * and every scan (pre-push and the required CI check) reported UNVERIFIED.
 *
 * The stub enforces maxBuffer exactly as execFileSync does — throwing when the output exceeds it, with
 * Node's 1 MiB default when none is passed — so a call that drops the option fails here.
 */
import { describe, expect, it } from 'vitest'

import { GIT_LS_FILES_MAX_BUFFER, listTrackedEnvFiles } from '../../scripts/secret-scan-env-files.mjs'

const NODE_DEFAULT_MAX_BUFFER = 1024 * 1024

function fakeExec(output: string) {
  return (_cmd: string, _args: string[], options: { maxBuffer?: number }) => {
    const limit = options?.maxBuffer ?? NODE_DEFAULT_MAX_BUFFER
    if (Buffer.byteLength(output) > limit) {
      const error = new Error('stdout maxBuffer length exceeded') as Error & { code: string }
      error.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      throw error
    }
    return output
  }
}

describe('listTrackedEnvFiles', () => {
  it('lists the tracked .env files from a >1 MiB git file list', () => {
    const filler = Array.from({ length: 30_000 }, (_, i) => `lib/generated/module-${i}-with-a-long-name.ts`)
    const output = [...filler, '.env.example', 'apps/web/.env.production', 'docs/env.md'].join('\0') + '\0'
    expect(Buffer.byteLength(output)).toBeGreaterThan(NODE_DEFAULT_MAX_BUFFER)

    expect(listTrackedEnvFiles('/repo', fakeExec(output) as never)).toEqual(['.env.example', 'apps/web/.env.production'])
  })

  it('the stub really enforces the default (control): without maxBuffer the same list throws', () => {
    const output = 'x'.repeat(NODE_DEFAULT_MAX_BUFFER + 1)
    expect(() => fakeExec(output)('git', [], {})).toThrow(/maxBuffer/)
  })

  it('uses the same 256 MiB ceiling as the scanner\'s other git ls-files call', () => {
    expect(GIT_LS_FILES_MAX_BUFFER).toBe(256 * 1024 * 1024)
  })
})

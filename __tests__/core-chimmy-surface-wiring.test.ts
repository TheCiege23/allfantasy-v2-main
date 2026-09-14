import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), 'utf8')

describe('Core to Chimmy surface wiring', () => {
  it('sends the validated tab context from the drawer', () => {
    const drawer = read('components', 'core-app', 'comms', 'CommsDrawer.tsx')
    expect(drawer).toContain("form.append('coreSurface', pageSurface)")
  })

  it('accepts only known Core tabs and grounds the model with them', () => {
    const route = read('app', 'api', 'chat', 'chimmy', 'route.ts')
    expect(route).toContain('z.enum(CORE_SURFACE_KEYS).optional()')
    expect(route).toContain('renderCoreSurfacePrompt(coreSurface)')
    expect(route).toContain('core_surface')
  })
})

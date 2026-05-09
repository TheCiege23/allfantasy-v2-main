import { render, screen } from '@testing-library/react'
import React from 'react'

/**
 * Regression guard for the vitest JSX pipeline.
 *
 * Background: vite 8 (rolldown-vite) routes transforms through oxc and
 * silently ignores the `esbuild` config block. Without explicit `oxc.jsx`
 * options, JSX tokens reach vite's SSR parser untransformed and fail with
 * `Unexpected JSX expression`, which surfaces as "Test Files: 1 failed,
 * Tests: no tests" — a confusing failure mode because no individual test
 * is reported as failing.
 *
 * If this file ever fails to even *parse*, the underlying transformer
 * regression is back. Keep this test minimal so it only fails for parse
 * issues, not behavioral changes elsewhere.
 */
function Hello({ name }: { name: string }) {
  return <span data-testid="hello">Hello, {name}!</span>
}

describe('vitest JSX pipeline', () => {
  it('parses and renders a basic React component', () => {
    render(<Hello name="World" />)
    expect(screen.getByTestId('hello')).toHaveTextContent('Hello, World!')
  })

  it('handles fragments and conditional children', () => {
    const Show = ({ flag }: { flag: boolean }) => (
      <>
        <span data-testid="always">always</span>
        {flag && <span data-testid="conditional">conditional</span>}
      </>
    )
    render(<Show flag />)
    expect(screen.getByTestId('always')).toBeInTheDocument()
    expect(screen.getByTestId('conditional')).toBeInTheDocument()
  })
})

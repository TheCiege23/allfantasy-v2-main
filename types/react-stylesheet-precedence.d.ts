import 'react'

/**
 * `precedence` on <link rel="stylesheet">, which React supports at runtime here
 * but @types/react@18 does not describe.
 *
 * The App Router ships its own React build, and that build implements the
 * stylesheet-resource ("float") behaviour: a <link rel="stylesheet"> carrying a
 * precedence is hoisted into the document head and emitted with a matching
 * `data-precedence` attribute — the same treatment Next's own route stylesheets
 * get. Without one React leaves the element wherever the tree puts it, which in
 * app/layout.tsx meant emitting it between the head and the body, and that is
 * what produced a full-document hydration bailout on every page. See the
 * comment on the font <link> in app/layout.tsx for the measurements.
 *
 * The published `precedence` typing arrives with React 19's types; this repo is
 * on 18.3.x, so the prop is a type error until it is declared. Declared here
 * rather than worked around at the call site on purpose: the obvious
 * alternative — spreading `{...{ precedence: 'default' }}` — compiles whatever
 * you type, so a misspelled key would silently stop hoisting the stylesheet and
 * bring the hydration bailout straight back with nothing to catch it. Naming
 * the prop keeps the spelling checked.
 *
 * Remove this file when the repo moves to React 19's type definitions, which
 * declare `precedence` themselves.
 */
declare module 'react' {
  interface LinkHTMLAttributes<T> {
    precedence?: string | undefined
  }
}

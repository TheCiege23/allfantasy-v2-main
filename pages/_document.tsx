import { Html, Head, Main, NextScript } from "next/document"

/**
 * A hybrid app/ + pages/ project needs an explicit pages-router `_document`
 * once any pages/*.tsx exists (500.tsx, the two e2e-g39/g40 harness routes).
 * Without one, Next's default document wrapper collides with the app-router
 * root layout during static generation and every pages-router special/error
 * page fails with "<Html> should not be imported outside of pages/_document."
 * — hit here on /404, /500, and the two e2e-g39/g40 routes.
 */
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}

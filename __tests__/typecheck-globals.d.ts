/**
 * Ambient types for the test tree, used only by `tsconfig.tests.json`.
 *
 * `vitest.setup.ts` imports '@testing-library/jest-dom', which installs the matchers at RUNTIME but
 * does not augment vitest's `Assertion` interface — that augmentation lives in the package's
 * separate `/vitest` entry point. So `expect(el).toBeInTheDocument()` works when the suite runs and
 * is a type error when the suite is typechecked, which is why 1,625 of the 2,810 errors in the test
 * tree were matcher-not-found rather than anything wrong with a test.
 *
 * `vitest/globals` does the same job for `describe` / `it` / `expect` / `vi`, which are injected by
 * `globals: true` in vitest.config.ts and are otherwise undeclared names.
 *
 * ⚠ THIS FILE LIVES UNDER `__tests__` DELIBERATELY. The base `tsconfig.json` excludes that whole
 * directory, so these references cannot leak into the application compile and cannot move the 145
 * baseline every session is measuring against. Putting it under the `types` directory would have
 * done exactly that, because the base config includes that directory's declaration files.
 *
 * (That sentence is written the long way on purpose: spelling the glob out literally would embed a
 * comment terminator inside this block and close it early, which is how the first version of this
 * file produced three syntax errors in a file containing no code.)
 */

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import { indefiniteArticleFor, withIndefiniteArticle } from "@/lib/text/indefiniteArticle"

describe("indefiniteArticleFor", () => {
  it("reads an initialism by the sound of its first letter, not its spelling", () => {
    // Every sport the create form offers begins with a consonant LETTER and
    // takes "an", which is why the naive vowel test shipped "a MLB".
    expect(indefiniteArticleFor("MLB")).toBe("an")
    expect(indefiniteArticleFor("NFL")).toBe("an")
    expect(indefiniteArticleFor("NBA")).toBe("an")
    expect(indefiniteArticleFor("NHL")).toBe("an")
    expect(indefiniteArticleFor("NCAA Football")).toBe("an")
    expect(indefiniteArticleFor("NCAA Basketball")).toBe("an")
  })

  it("keeps 'a' for the letters that are said with a consonant sound", () => {
    expect(indefiniteArticleFor("UFC")).toBe("a") // "you-ef-see"
    expect(indefiniteArticleFor("PGA")).toBe("a")
    expect(indefiniteArticleFor("WNBA")).toBe("a") // "double-you"
    expect(indefiniteArticleFor("KHL")).toBe("a")
  })

  it("falls back to the vowel letter for an ordinary word", () => {
    expect(indefiniteArticleFor("Soccer")).toBe("a")
    expect(indefiniteArticleFor("elimination")).toBe("an")
    expect(indefiniteArticleFor("Open")).toBe("an")
  })

  it("does not throw on nothing", () => {
    expect(indefiniteArticleFor("")).toBe("a")
    expect(indefiniteArticleFor(null)).toBe("a")
    expect(indefiniteArticleFor(undefined)).toBe("a")
    expect(withIndefiniteArticle(null)).toBe("")
    expect(withIndefiniteArticle("MLB")).toBe("an MLB")
  })
})

/**
 * 🛑 THE BUG WAS A LITERAL IN JSX, so a unit test of the helper cannot see a
 * regression at the place it actually shipped. This reads the page source: if
 * anyone writes the article back into the sentence, it fails.
 */
describe("the create page's subtitle", () => {
  const src = readFileSync(
    resolve(__dirname, "..", "app/brackets/leagues/new/page.tsx"),
    "utf8",
  )

  it("derives the article instead of hard-coding one", () => {
    expect(src).toContain("indefiniteArticleFor(sportLabel)")
    expect(src).not.toMatch(/Build a \{sportLabel\}/)
    expect(src).not.toMatch(/Build an \{sportLabel\}/)
  })
})

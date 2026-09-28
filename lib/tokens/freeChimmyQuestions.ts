/**
 * How many Chimmy questions a free account gets a day — the number, alone, with no server imports.
 *
 * `dailyFreeTokens.ts` enforces it and re-exports it. It lives here because the chat drawer tells an
 * out-of-tokens user when their free questions come back, and a client component cannot import a
 * module that pulls in Prisma. One definition, so the drawer cannot promise a floor the grant does
 * not pay.
 */
export const FREE_CHIMMY_QUESTIONS_PER_DAY: number = 2

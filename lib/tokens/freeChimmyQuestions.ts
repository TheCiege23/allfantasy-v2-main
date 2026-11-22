/**
 * How many Chimmy questions a free account gets a day — the number, alone, with no server imports.
 *
 * `planAllowance.ts` counts answers separately from purchased tokens. It lives here because the chat drawer tells an
 * out-of-tokens user when their free questions come back, and a client component cannot import a
 * module that pulls in Prisma. One definition keeps the counter and the daily answer display aligned.
 */
export const FREE_CHIMMY_QUESTIONS_PER_DAY: number = 2

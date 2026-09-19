import "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      username?: string | null
      image?: string | null
      /*
       * 🛑 `spotifyAccount` WAS HERE AND IS GONE ON PURPOSE. A boolean on the session has to be
       * computed eagerly, so it cost one or two prisma reads on EVERY authenticated request in
       * the product — for a fact read by exactly one hook. It now rides on the
       * `/api/music/favorites` response that same hook already fetches. Do not put a
       * database-derived flag back on this object without asking what it costs at ~2,259
       * `getServerSession` call sites.
       */
    }
  }

  interface User {
    id: string
    name?: string | null
    email?: string | null
    username?: string | null
    image?: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string
    sub?: string
    username?: string | null
  }
}

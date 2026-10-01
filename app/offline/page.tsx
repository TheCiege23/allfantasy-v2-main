export const metadata = {
  title: 'Offline | AllFantasy',
  description: 'Offline fallback page for AllFantasy.',
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#020617] px-6 text-center text-white">
      <img src="/af-crest.svg" alt="AllFantasy" className="mb-6 h-20 w-auto opacity-80" />
      <h1 className="mb-2 text-2xl font-bold">You&apos;re offline</h1>
      <p className="mb-6 text-white/55">Check your connection and try again.</p>
      <a
        href="."
        className="rounded-xl bg-cyan-500 px-6 py-3 font-bold text-black transition hover:bg-cyan-400"
      >
        Retry
      </a>
    </main>
  );
}

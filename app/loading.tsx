export default function HomeLoading() {
  return (
    <div className="ai-home-bg relative isolate flex w-full flex-1 flex-col">
      {/* Ambient blobs */}
      <div className="pointer-events-none absolute -left-16 top-12 h-64 w-64 rounded-full bg-cyan-300/25 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-24 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6 md:gap-5 md:px-10 md:py-8">
        {/* Hero panel skeleton */}
        <div className="rounded-3xl border border-slate-200/60 bg-white/80 px-6 py-7 md:px-10 md:py-9">
          {/* Drop zone skeleton */}
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-8 md:p-12">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 animate-pulse rounded-2xl bg-slate-200" />
              <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
              <div className="h-4 w-72 animate-pulse rounded-md bg-slate-100" />
            </div>
          </div>

          {/* Search bar skeleton */}
          <div className="mt-5 h-12 animate-pulse rounded-xl bg-slate-200/70" />
        </div>

        {/* Carousel skeleton */}
        <div className="overflow-hidden py-4">
          <div className="flex gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="h-9 w-28 flex-shrink-0 animate-pulse rounded-full bg-slate-200"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        </div>

        {/* Trust badge skeleton */}
        <div className="flex justify-center">
          <div className="h-8 w-96 animate-pulse rounded-full bg-slate-200/70" />
        </div>

        {/* Workflow recipe cards skeleton */}
        <div className="rounded-2xl border border-slate-200/60 bg-white/80 p-4">
          <div className="mb-3 h-6 w-44 animate-pulse rounded-md bg-slate-200" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-50 p-4"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="mb-2 h-4 w-24 rounded bg-slate-200" />
                <div className="mb-1 h-3 w-36 rounded bg-slate-100" />
                <div className="mb-1 h-3 w-28 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

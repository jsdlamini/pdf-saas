export default function ToolPageLoading() {
  return (
    <main className="depth-stage mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10 md:px-10">
      {/* Breadcrumb skeleton */}
      <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />

      {/* Tool workbench skeleton */}
      <section className="space-y-4 rounded-3xl border border-slate-200/60 bg-white p-4 xl:p-5 shadow-sm">
        {/* Header */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <div className="h-7 w-48 animate-pulse rounded-md bg-slate-200" />
          <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
        </div>
        <div className="h-4 w-96 animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-64 animate-pulse rounded bg-slate-100" />

        {/* Control area */}
        <div className="mt-6 space-y-4 rounded-xl border border-slate-200/60 bg-slate-50/60 p-4">
          {/* File input area */}
          <div className="h-32 animate-pulse rounded-xl border-2 border-dashed border-slate-200 bg-slate-100/60" />

          {/* Controls row */}
          <div className="flex flex-wrap gap-3">
            <div className="h-10 w-32 animate-pulse rounded-xl bg-slate-200" />
            <div className="h-10 w-40 animate-pulse rounded-xl bg-slate-200" />
            <div className="h-10 w-28 animate-pulse rounded-xl bg-slate-200" />
          </div>
        </div>

        {/* Output area placeholder */}
        <div className="mt-4 h-48 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
      </section>

      {/* Related tools skeleton */}
      <section className="space-y-3 rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-100" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-xl bg-slate-100"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

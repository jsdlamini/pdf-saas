import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "How WiserFiles works — which tools run in your browser, which use our servers, file limits, and how to get started.",
  alternates: { canonical: "/docs" },
};

export default function DocsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10 md:px-10">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
          How WiserFiles works
        </h1>
        <p className="text-slate-600">
          The short version: most tools run entirely in your browser, and files sent to
          our servers are deleted as soon as processing finishes.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-display text-lg font-semibold text-slate-950">Getting started</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>Drop a file on the home page — or pick a tool from the grid.</li>
          <li>Adjust the options for that tool.</li>
          <li>Run it, then download or share the result.</li>
        </ol>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-display text-lg font-semibold text-slate-950">In the browser vs. on our servers</h2>
        <p className="text-sm text-slate-700">
          Tools that only read or rearrange PDFs (merge, split, rotate, compress, sign, and
          more) run on your device — your file never leaves it. A few tools (OCR, PDF to Word,
          and other format conversions) need our servers to do the heavy lifting.
        </p>
        <p className="text-sm text-slate-700">
          Server-side files are processed in isolated temporary storage and deleted immediately
          after the result is returned.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-display text-lg font-semibold text-slate-950">Research Studio</h2>
        <p className="text-sm text-slate-700">
          A full LaTeX editor with live PDF preview, GitHub sync, version history, and live
          collaboration. Open it from the nav or the home page.
        </p>
        <Link
          href="/research-studio"
          className="inline-flex items-center gap-2 rounded-full bg-[#1e40af] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#1e3a8a]"
        >
          Open Research Studio
        </Link>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-display text-lg font-semibold text-slate-950">More help</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li><Link href="/faq" className="text-[#1e40af] underline">Frequently asked questions</Link></li>
          <li><Link href="/privacy" className="text-[#1e40af] underline">Privacy policy</Link></li>
          <li><Link href="/terms" className="text-[#1e40af] underline">Terms of service</Link></li>
        </ul>
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description:
    "WiserFiles is built by Ideal Software Solutions — an online PDF toolkit and LaTeX Research Studio.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10 md:px-10">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
          About
        </h1>
        <p className="text-slate-600">
          WiserFiles is built by <span className="font-semibold text-slate-800">Ideal Software Solutions</span>.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-display text-lg font-semibold text-slate-950">Why it exists</h2>
        <p className="text-sm text-slate-700">
          It started with a thesis. The tools we could find either watermarked the output,
          capped how many files you could process, or wanted a subscription to download your
          own document. So we built the thing we wanted: 25 PDF tools that mostly run in your
          browser, plus a LaTeX editor for the writing itself.
        </p>
        <p className="text-sm text-slate-700">
          It's built in Eswatini, for researchers and students — the ones who can't justify
          Overleaf Pro but still need to get a paper out.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-display text-lg font-semibold text-slate-950">Privacy first</h2>
        <p className="text-sm text-slate-700">
          Tools that can run locally stay in your browser. When a file must reach our servers,
          it is processed in isolated temporary storage and deleted immediately afterwards.
        </p>
        <Link href="/privacy" className="text-sm font-semibold text-[#1e40af] underline">
          Read the privacy policy
        </Link>
      </section>
    </main>
  );
}

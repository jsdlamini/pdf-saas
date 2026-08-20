import type { Metadata } from "next";
import FaqContent from "./faq-content";

export const metadata: Metadata = {
  title: "Frequently Asked Questions",
  description:
    "Answers to common questions about WiserFiles PDF tools — file safety, upload limits, offline tools, server tools, supported formats, and more.",
  alternates: {
    canonical: "/faq",
  },
  openGraph: {
    type: "website",
    url: "/faq",
    title: "Frequently Asked Questions | WiserFiles",
    description:
      "Answers to common questions about file safety, upload limits, offline tools, and more.",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Frequently Asked Questions | WiserFiles",
    description:
      "Answers to common questions about file safety, upload limits, offline tools, and more.",
    images: ["/opengraph-image"],
  },
};

export default function FaqPage() {
  return (
    <main className="depth-stage mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10 md:px-10">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
          Frequently Asked Questions
        </h1>
        <p className="text-slate-600">
          Quick answers to the most common questions about WiserFiles.
        </p>
      </div>
      <FaqContent />
    </main>
  );
}

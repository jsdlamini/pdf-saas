import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSeoLandingBySlug, SEO_LANDING_PAGES } from "@/lib/seo-landing-pages";
import { getToolBySlug, TOOL_ITEMS } from "@/lib/tools";

type LandingPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return SEO_LANDING_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: LandingPageProps): Promise<Metadata> {
  const { slug } = await params;
  const landing = getSeoLandingBySlug(slug);

  if (!landing) {
    return {
      title: "Page Not Found",
      robots: { index: false, follow: false },
    };
  }

  const title = `${landing.title} | WiserFiles`;
  const description = `${landing.description} Use WiserFiles to process PDFs quickly online.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/online/${landing.slug}`,
    },
    keywords: [landing.keyword, landing.title, "online pdf tools", "WiserFiles"],
    openGraph: {
      type: "website",
      url: `/online/${landing.slug}`,
      title,
      description,
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
    },
  };
}

export default async function LandingPage({ params }: LandingPageProps) {
  const { slug } = await params;
  const landing = getSeoLandingBySlug(slug);
  if (!landing) notFound();

  const tool = getToolBySlug(landing.toolSlug);
  if (!tool) notFound();

  const relatedTools = TOOL_ITEMS.filter(
    (candidate) => candidate.category === tool.category && candidate.slug !== tool.slug
  ).slice(0, 4);

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const faqItems = [
    {
      question: `How can I ${landing.keyword}?`,
      answer: `Open ${tool.name} in WiserFiles, upload your file, apply options, and download the output in one workflow.`,
    },
    {
      question: `Do I need to install anything for ${landing.title}?`,
      answer: `No installation is needed. WiserFiles runs in your browser.`,
    },
    {
      question: `Can I continue from ${landing.title} into another tool?`,
      answer: `Yes. You can start a suggested workflow and move between related tools without re-uploading.`,
    },
  ];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: siteUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Online PDF Tools",
        item: `${siteUrl}/online/${landing.slug}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: tool.name,
        item: `${siteUrl}/tools/${tool.slug}`,
      },
    ],
  };

  return (
    <main className="depth-stage mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10 md:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

      <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">Online PDF Tool</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
          {landing.title}
        </h1>
        <p className="max-w-3xl text-base text-slate-700">{landing.description}</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/tools/${tool.slug}`}
            className="rounded-full bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-700"
          >
            Open {tool.name}
          </Link>
          <Link
            href="/"
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
          >
            Browse all tools
          </Link>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-xl font-semibold tracking-tight text-slate-950">How to use {tool.name}</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>Upload your file in the {tool.name} workspace.</li>
          <li>Adjust options based on your document goals.</li>
          <li>Run the tool and preview the output.</li>
          <li>Download your processed file or continue in workflow mode.</li>
        </ol>
      </section>

      {relatedTools.length ? (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-display text-xl font-semibold tracking-tight text-slate-950">Related tools</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {relatedTools.map((related) => (
              <Link
                key={related.slug}
                href={`/tools/${related.slug}`}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
              >
                {related.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-xl font-semibold tracking-tight text-slate-950">{tool.name} FAQ</h2>
        <div className="space-y-2">
          {faqItems.map((faq) => (
            <details key={faq.question} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">{faq.question}</summary>
              <p className="mt-2 text-sm text-slate-600">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm text-slate-600">
          Looking for more PDF operations? Explore the full tool directory for merge, split, convert, OCR, edit, and security workflows.
        </p>
      </section>
    </main>
  );
}

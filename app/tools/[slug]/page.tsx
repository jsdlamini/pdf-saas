import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ProjectSessionCta from "@/app/project-session-cta";
import ToolWorkbench from "../tool-workbench";
import { getToolBySlug, TOOL_ITEMS } from "@/lib/tools";

type ToolPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return TOOL_ITEMS.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({ params }: ToolPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tool = getToolBySlug(slug);

  if (!tool) {
    return {
      title: "Tool Not Found",
      robots: { index: false, follow: false },
    };
  }

  const title = `${tool.name} — Free Online PDF Tool | WiserFiles`;
  const description = tool.description;

  return {
    title,
    description,
    alternates: {
      canonical: `/tools/${tool.slug}`,
    },
    keywords: [tool.name, `${tool.name} online free`, "free PDF tool", "PDF tools", tool.category],
    openGraph: {
      type: "website",
      url: `/tools/${tool.slug}`,
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

export default async function ToolPage({ params }: ToolPageProps) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);

  if (!tool) {
    notFound();
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const toolUrl = `${siteUrl.replace(/\/$/, "")}/tools/${tool.slug}`;
  const toolSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `${tool.name} - WiserFiles`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: tool.description,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    url: toolUrl,
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
        name: "Tools",
        item: `${siteUrl.replace(/\/$/, "")}/`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: tool.name,
        item: toolUrl,
      },
    ],
  };

  const relatedTools = TOOL_ITEMS.filter(
    (candidate) => candidate.category === tool.category && candidate.slug !== tool.slug
  ).slice(0, 6);

  const faqItems = [
    {
      question: `How do I use ${tool.name} online?`,
      answer: `Upload your file, adjust ${tool.name} options, run the tool, and download the processed document.`,
    },
    {
      question: `Is ${tool.name} free to try?`,
      answer: `${tool.name} is available in the WiserFiles workspace and can be tested directly in your browser.`,
    },
    {
      question: `What file types work best with ${tool.name}?`,
      answer: `For best results, use source files that match the tool intent and review the output preview before download.`,
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

  return (
    <main className="depth-stage mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10 md:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(toolSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <ProjectSessionCta />
      <Suspense>
        <ToolWorkbench tool={tool} />
      </Suspense>

      {relatedTools.length ? (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
          <h2 className="font-display text-xl font-semibold tracking-tight text-slate-950">
            Related {tool.category} PDF tools
          </h2>
          <p className="text-sm text-slate-600">
            Explore nearby workflows often used with {tool.name.toLowerCase()}.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
        <h2 className="font-display text-xl font-semibold tracking-tight text-slate-950">
          {tool.name} FAQ
        </h2>
        <div className="space-y-2">
          {faqItems.map((faq) => (
            <details key={faq.question} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">{faq.question}</summary>
              <p className="mt-2 text-sm text-slate-600">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}

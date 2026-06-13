import { Suspense } from "react";
import { notFound } from "next/navigation";
import ToolWorkbench from "../tool-workbench";
import { getToolBySlug, TOOL_ITEMS } from "@/lib/tools";

type ToolPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return TOOL_ITEMS.map((tool) => ({ slug: tool.slug }));
}

export default async function ToolPage({ params }: ToolPageProps) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);

  if (!tool) {
    notFound();
  }

  return (
    <main className="depth-stage mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10 md:px-10">
      <Suspense>
        <ToolWorkbench tool={tool} />
      </Suspense>
    </main>
  );
}

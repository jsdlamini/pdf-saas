import Link from "next/link";
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
      <header className="glass-3d space-y-4 rounded-3xl p-6">
        <Link
          href="/"
          className="inline-flex items-center rounded-full border border-slate-300 bg-slate-950 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
        >
          Back to all tools
        </Link>
        <div>
          <p className="type-eyebrow text-cyan-700">
            {tool.category}
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
            {tool.name}
          </h1>
          <p className="field-help mt-2">
            Review settings below, upload your file, and export a processed output.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`status-chip ${tool.runtime === "client" ? "status-chip-live" : "status-chip-server"}`}>
            {tool.runtime === "client" ? "In Browser" : "Server Workflow"}
          </span>
          <span className="status-chip status-chip-ok">Ready</span>
        </div>
      </header>

      <ToolWorkbench tool={tool} />
    </main>
  );
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Research Studio",
  description:
    "Write, compile, and collaborate on LaTeX, Python, and C++ projects with live PDF preview, version history, and AI assistance.",
  alternates: { canonical: "/research-studio" },
};

export default function ResearchStudioLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

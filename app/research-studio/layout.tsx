import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Research Studio",
  description:
    "Write, compile, and collaborate on LaTeX, Python, and C++ projects with live PDF preview, version history, and AI assistance.",
  alternates: { canonical: "/research-studio" },
  keywords: [
    "LaTeX editor",
    "online LaTeX",
    "LaTeX compiler",
    "PDF preview",
    "Overleaf alternative",
    "GitHub LaTeX",
    "collaborative LaTeX",
    "research writing",
    "WiserFiles",
  ],
  openGraph: {
    type: "website",
    url: "/research-studio",
    title: "Research Studio — LaTeX Editor with Live PDF Preview | WiserFiles",
    description:
      "Write, compile, and collaborate on LaTeX, Python, and C++ with live PDF preview, GitHub sync, version history, and AI assistance.",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Research Studio — LaTeX Editor with Live PDF Preview | WiserFiles",
    description:
      "Write, compile, and collaborate on LaTeX, Python, and C++ with live PDF preview, GitHub sync, and AI assistance.",
    images: ["/opengraph-image"],
  },
};

export default function ResearchStudioLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

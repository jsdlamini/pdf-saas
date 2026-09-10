"use client";

// Static, text-only hero showcase: one card per language. No code preview and
// no typing/rotation animation — just an appealing, at-a-glance summary.

type Slide = {
  id: "latex" | "python" | "cpp";
  title: string;
  tagline: string;
  description: string;
  features: string[];
  accent: string;
};

const SLIDES: Slide[] = [
  {
    id: "latex",
    title: "LaTeX",
    tagline: "Write papers and theses, and compile to a PDF beside you.",
    description:
      "The editor recompiles as you type, resolves figures and citations, and shows the PDF next to your source.",
    features: ["Live PDF preview", "Figures & images", "Citation autocomplete", "AI writing help"],
    accent: "#a78bfa",
  },
  {
    id: "python",
    title: "Python",
    tagline: "Run scripts and notebooks with instant output.",
    description:
      "Multi-file Python projects run in a sandbox with a live output panel — imports, NumPy, and Matplotlib figures all work.",
    features: ["Multi-file projects", "Instant output", "Matplotlib figures", "Sandboxed runs"],
    accent: "#2dd4bf",
  },
  {
    id: "cpp",
    title: "C++",
    tagline: "Build and run native code with a live output panel.",
    description:
      "Multi-file C++ projects compile with g++ and run in a sandbox, printing results to a live output panel.",
    features: ["Multi-file compile", "g++ build", "Live output", "Sandboxed runs"],
    accent: "#fb923c",
  },
];

export default function StudioHeroCards({ onLaunch }: { onLaunch?: () => void }) {
  return (
    <div className="studio-hero-showcase">
      {SLIDES.map((slide) => (
        <article
          key={slide.id}
          className="studio-hero-card"
          style={{ borderTopColor: slide.accent }}
        >
          <h2 className="studio-hero-showcase-title" style={{ color: slide.accent }}>
            {slide.title}
          </h2>
          <p className="studio-hero-showcase-tagline">{slide.tagline}</p>
          <p className="studio-hero-showcase-desc">{slide.description}</p>
          <ul className="studio-hero-showcase-features">
            {slide.features.map((feature) => (
              <li key={feature}>
                <svg
                  viewBox="0 0 20 20"
                  style={{ width: 14, height: 14 }}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 10l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="studio-hero-card-cta"
            onClick={onLaunch}
            style={{ color: slide.accent, borderColor: slide.accent }}
          >
            Start a {slide.title} project →
          </button>
        </article>
      ))}
    </div>
  );
}

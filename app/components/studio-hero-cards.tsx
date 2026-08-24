"use client";

import { useEffect, useRef, useState } from "react";

// Rotating hero showcase: one language at a time — descriptor text on the left,
// a live-typing code card on the right — fading out before the next language.
type Slide = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  features: string[];
  accent: string;
  file: string;
  status: string;
  code: string;
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
    file: "main.tex",
    status: "Compiled · PDF ready",
    code: `\\documentclass{article}
\\usepackage{graphicx}
\\usepackage{amsmath}

\\title{My Paper}
\\begin{document}
\\section{Introduction}
We study the effect of...

\\begin{equation}
  E = 1 - e^{-\\gamma t}
\\end{equation}
\\end{document}`,
  },
  {
    id: "python",
    title: "Python",
    tagline: "Run scripts and notebooks with instant output.",
    description:
      "Multi-file Python projects run in a sandbox with a live output panel — imports, NumPy, and Matplotlib figures all work.",
    features: ["Multi-file projects", "Instant output", "Matplotlib figures", "Sandboxed runs"],
    accent: "#2dd4bf",
    file: "main.py",
    status: "Ran successfully",
    code: `import numpy as np

def main():
    data = np.load("data.npy")
    print("mean:", data.mean())
    print("std :", data.std())

if __name__ == "__main__":
    main()`,
  },
  {
    id: "cpp",
    title: "C++",
    tagline: "Build and run native code with a live output panel.",
    description:
      "Multi-file C++ projects compile with g++ and run in a sandbox, printing results to a live output panel.",
    features: ["Multi-file compile", "g++ build", "Live output", "Sandboxed runs"],
    accent: "#fb923c",
    file: "main.cpp",
    status: "Built · exit 0",
    code: `#include <iostream>
#include <vector>
#include <numeric>

int main() {
  std::vector<int> v(100);
  std::iota(v.begin(), v.end(), 1);

  long sum = std::accumulate(
      v.begin(), v.end(), 0L);

  std::cout << "sum: " << sum << "\\n";
  return 0;
}`,
  },
];

const ROTATE_MS = 7000;
const FADE_MS = 450;

export default function StudioHeroCards() {
  const [active, setActive] = useState(0);
  const [count, setCount] = useState(0);
  const [fading, setFading] = useState(false);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current =
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const slide = SLIDES[active];

  // Live typing for the active slide.
  useEffect(() => {
    if (reducedRef.current) {
      setCount(slide.code.length);
      return;
    }
    setCount(0);
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= slide.code.length) clearInterval(interval);
    }, 14);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Rotate: fade out, swap, fade in.
  useEffect(() => {
    if (reducedRef.current) return;
    const timer = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setActive((a) => (a + 1) % SLIDES.length);
        setFading(false);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="studio-hero-showcase" style={{ opacity: fading ? 0 : 1 }}>
      <div className="studio-hero-showcase-copy">
        <h1 className="studio-hero-showcase-title" style={{ color: slide.accent }}>
          {slide.title}
        </h1>
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
      </div>
      <div
        className="studio-hero-showcase-code"
        style={{ borderTop: `3px solid ${slide.accent}` }}
      >
        <div className="studio-hero-showcase-bar">
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: slide.accent }} />
          <span className="studio-hero-showcase-file">{slide.file}</span>
          <span className="studio-hero-showcase-status" style={{ color: slide.accent }}>
            {slide.status}
          </span>
        </div>
        <pre className="studio-hero-showcase-code-text">
          {slide.code.slice(0, count)}
          <span className="studio-hero-cursor" style={{ background: slide.accent }} />
        </pre>
      </div>
    </div>
  );
}

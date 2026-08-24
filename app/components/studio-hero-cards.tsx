"use client";

import { useEffect, useRef, useState } from "react";

// Three live-typing mini editor cards (LaTeX / Python / C++) for the studio
// hero. Each types its code character-by-character, holds, then loops.
type CardSpec = {
  mode: string;
  file: string;
  accent: string;
  code: string;
};

const CARDS: CardSpec[] = [
  {
    mode: "latex",
    file: "main.tex",
    accent: "#a78bfa",
    code: `\\documentclass{article}
\\usepackage{graphicx}
\\title{My Paper}
\\begin{document}
\\section{Introduction}
We study the effect of...
\\end{document}`,
  },
  {
    mode: "python",
    file: "main.py",
    accent: "#2dd4bf",
    code: `import numpy as np

def main():
    data = np.load("data.npy")
    print(data.shape)

if __name__ == "__main__":
    main()`,
  },
  {
    mode: "cpp",
    file: "main.cpp",
    accent: "#fb923c",
    code: `#include <iostream>
#include <vector>

int main() {
  std::vector<int> v{1, 2, 3};
  std::cout << v.size() << "\\n";
  return 0;
}`,
  },
];

function TypeCard({ spec, delay }: { spec: CardSpec; delay: number }) {
  const [count, setCount] = useState(0);
  const [cycle, setCycle] = useState(0);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current =
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const full = spec.code.length;

  useEffect(() => {
    if (reducedRef.current) {
      setCount(full);
      return;
    }
    let interval: ReturnType<typeof setInterval> | null = null;
    let hold: ReturnType<typeof setTimeout> | null = null;
    const start = setTimeout(() => {
      let i = 0;
      interval = setInterval(() => {
        i += 1;
        setCount(i);
        if (i >= full && interval) {
          clearInterval(interval);
          interval = null;
          hold = setTimeout(() => {
            setCount(0);
            setCycle((c) => c + 1);
          }, 3200);
        }
      }, 26);
    }, delay);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
      if (hold) clearTimeout(hold);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle, delay, full]);

  return (
    <div
      className="studio-hero-card"
      style={{ animationDelay: `${delay + 200}ms`, borderTop: `2px solid ${spec.accent}` }}
    >
      <div className="studio-hero-card-bar">
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: spec.accent }} />
        <span className="studio-hero-card-file">{spec.file}</span>
        <span className="studio-hero-card-mode" style={{ color: spec.accent }}>
          {spec.mode}
        </span>
      </div>
      <pre className="studio-hero-card-code">
        {spec.code.slice(0, count)}
        <span className="studio-hero-cursor" style={{ background: spec.accent }} />
      </pre>
    </div>
  );
}

export default function StudioHeroCards() {
  return (
    <div className="studio-hero-cards">
      {CARDS.map((spec, i) => (
        <TypeCard key={spec.mode} spec={spec} delay={i * 900} />
      ))}
    </div>
  );
}

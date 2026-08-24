"use client";

import { useEffect, useRef, useState } from "react";

// Three large, separate live-typing editor cards (LaTeX / Python / C++) for the
// studio hero. Each card types its own code, holds, then loops.
type CardSpec = {
  mode: string;
  file: string;
  accent: string;
  status: string;
  code: string;
};

const CARDS: CardSpec[] = [
  {
    mode: "latex",
    file: "main.tex",
    accent: "#a78bfa",
    status: "Compiled · PDF ready",
    code: `\\documentclass{article}
\\usepackage{graphicx}
\\usepackage{amsmath}

\\title{Quantum Error Rates}
\\author{J. Dlamini}

\\begin{document}
\\maketitle

\\section{Introduction}
We study the effect of
decoherence on the error
rate of surface codes.

\\begin{equation}
  E = 1 - e^{-\\gamma t}
\\end{equation}
\\end{document}`,
  },
  {
    mode: "python",
    file: "main.py",
    accent: "#2dd4bf",
    status: "Ran successfully",
    code: `import numpy as np
import matplotlib.pyplot as plt

def simulate(n=1000):
    data = np.random.randn(n)
    return data

if __name__ == "__main__":
    data = simulate()
    print("mean:", data.mean())
    print("std :", data.std())
    plt.hist(data, bins=40)
    plt.savefig("hist.png")`,
  },
  {
    mode: "cpp",
    file: "main.cpp",
    accent: "#fb923c",
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
  std::cout << "mean: "
            << sum / v.size() << "\\n";
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
          }, 3600);
        }
      }, 18);
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
      style={{ animationDelay: `${delay + 150}ms`, borderTop: `3px solid ${spec.accent}` }}
    >
      <div className="studio-hero-card-bar">
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: spec.accent }} />
        <span className="studio-hero-card-file">{spec.file}</span>
        <span className="studio-hero-card-mode" style={{ color: spec.accent }}>
          {spec.mode}
        </span>
      </div>
      <pre className="studio-hero-card-code">
        {spec.code.slice(0, count)}
        <span className="studio-hero-cursor" style={{ background: spec.accent }} />
      </pre>
      <div className="studio-hero-card-foot">
        <span className="studio-hero-card-foot-dot" style={{ background: spec.accent }} />
        <span>{spec.status}</span>
      </div>
    </div>
  );
}

export default function StudioHeroCards() {
  return (
    <div className="studio-hero-cards">
      {CARDS.map((spec, i) => (
        <TypeCard key={spec.mode} spec={spec} delay={i * 700} />
      ))}
    </div>
  );
}

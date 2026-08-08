"use client";

import { useEffect, useState, useCallback } from "react";

const ONBOARDING_KEY = "wiserfiles-onboarding-seen";

const STEPS = [
  {
    title: "Drop your file here",
    body: "Drag any PDF, Word doc, or image onto this zone. WiserFiles will detect the file type and suggest the best tools for you.",
    targetSelector: "#hero-drop-zone",
    position: "bottom",
  },
  {
    title: "After dropping, pick an action",
    body: "Once your file is in the drop zone above, suggested tools like Merge, Compress, or OCR will appear right here. Click one to process your file instantly.",
    targetSelector: "#hero-drop-zone",
    position: "bottom",
  },
  {
    title: "Search or browse all tools",
    body: "Use the search bar or browse the animated tool carousel above to find any tool. Process files instantly and download with one click — nothing is ever stored.",
    targetSelector: "#intent-input",
    position: "top",
  },
];

export default function Onboarding() {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [entering, setEntering] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const positionTooltip = useCallback((index: number) => {
    const step = STEPS[index];
    const target = document.querySelector(step.targetSelector);
    if (!target) {
      // Fallback: center in viewport
      const rect = { left: window.innerWidth / 2 - 160, top: window.innerHeight / 2 - 80, width: 320, height: 100 } as DOMRect;
      setTooltipStyle({
        position: "fixed",
        left: `${rect.left + rect.width / 2}px`,
        top: `${rect.top + rect.height + 12}px`,
        transform: "translateX(-50%)",
      });
      return;
    }

    const rect = target.getBoundingClientRect();
    const tooltipWidth = 320;

    if (step.position === "bottom") {
      setTooltipStyle({
        position: "fixed",
        left: `${Math.max(16, Math.min(rect.left + rect.width / 2 - tooltipWidth / 2, window.innerWidth - tooltipWidth - 16))}px`,
        top: `${rect.bottom + 12}px`,
      });
    } else {
      setTooltipStyle({
        position: "fixed",
        left: `${Math.max(16, Math.min(rect.left + rect.width / 2 - tooltipWidth / 2, window.innerWidth - tooltipWidth - 16))}px`,
        top: `${rect.top - 12}px`,
        transform: "translateY(-100%)",
      });
    }
  }, []);

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_KEY);
    if (!seen) {
      const timer = setTimeout(() => {
        setVisible(true);
        setEntering(true);
        positionTooltip(0);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [positionTooltip]);

  useEffect(() => {
    if (visible) positionTooltip(stepIndex);
  }, [stepIndex, visible, positionTooltip]);

  function dismiss() {
    setEntering(false);
    setTimeout(() => {
      setVisible(false);
      localStorage.setItem(ONBOARDING_KEY, "1");
    }, 250);
  }

  function nextStep() {
    if (stepIndex < STEPS.length - 1) {
      setEntering(false);
      setTimeout(() => {
        setStepIndex((s) => s + 1);
        setEntering(true);
      }, 200);
    } else {
      dismiss();
    }
  }

  if (!visible) return null;

  const step = STEPS[stepIndex];

  return (
    <>
      {/* Subtle overlay to dim background */}
      <div className="fixed inset-0 z-[88] bg-black/15 transition-opacity duration-300" onClick={dismiss} />

      {/* Highlight ring around target */}
      <div
        className="pointer-events-none fixed z-[89] rounded-xl ring-4 ring-cyan-400/60 animate-pulse transition-all duration-300"
        style={{
          left: "50%",
          top: "50%",
          width: 0,
          height: 0,
        }}
        ref={(el) => {
          if (!el) return;
          const target = document.querySelector(step.targetSelector);
          if (!target) { el.style.display = "none"; return; }
          el.style.display = "block";
          const rect = target.getBoundingClientRect();
          el.style.left = `${rect.left - 4}px`;
          el.style.top = `${rect.top - 4}px`;
          el.style.width = `${rect.width + 8}px`;
          el.style.height = `${rect.height + 8}px`;
        }}
      />

      {/* Tooltip card */}
      <div
        className={`fixed z-[90] w-80 transition-all duration-300 ${
          entering ? "translate-y-0 opacity-100 scale-100" : "translate-y-4 opacity-0 scale-95"
        }`}
        style={tooltipStyle}
      >
        <div className="rounded-2xl border border-cyan-200 bg-white px-5 py-4 shadow-[0_20px_60px_-18px_rgba(6,182,212,0.5)] dark:border-cyan-700 dark:bg-slate-900">
          {/* Step dots */}
          <div className="mb-3 flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`block h-1.5 rounded-full transition-all duration-300 ${
                  i === stepIndex
                    ? "w-5 bg-gradient-to-r from-cyan-400 to-sky-500"
                    : i < stepIndex
                      ? "w-1.5 bg-cyan-300"
                      : "w-1.5 bg-slate-200 dark:bg-slate-700"
                }`}
              />
            ))}
            <span className="ml-auto text-[10px] font-semibold text-slate-400">
              {stepIndex + 1} of {STEPS.length}
            </span>
          </div>

          <p className="font-display text-base font-semibold text-slate-950 dark:text-white">
            {step.title}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {step.body}
          </p>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={dismiss}
              className="text-xs font-medium text-slate-400 underline-offset-2 transition hover:text-slate-600 hover:underline dark:text-slate-500 dark:hover:text-slate-300"
            >
              Skip tutorial
            </button>
            <button
              type="button"
              onClick={nextStep}
              className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-1.5 text-sm font-semibold text-white shadow-md shadow-cyan-400/30 transition hover:shadow-lg hover:shadow-cyan-400/40 active:scale-95"
            >
              {stepIndex < STEPS.length - 1 ? "Next" : "Got it!"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

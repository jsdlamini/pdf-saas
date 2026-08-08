"use client";

import { useEffect, useState } from "react";

const ONBOARDING_KEY = "wiserfiles-onboarding-seen";

const STEPS = [
  {
    title: "1. Drop your file here",
    body: "Start by dragging any PDF, image, or document onto the drop zone. WiserFiles handles PDFs, PNGs, JPGs, and more.",
    highlight: "drop-zone",
  },
  {
    title: "2. Pick a tool or let us suggest one",
    body: "Once your file is loaded, choose from quick-action pills like Merge, Compress, or OCR. We'll suggest the best tools for your file type.",
    highlight: "tool-pills",
  },
  {
    title: "3. Download your processed file",
    body: "After processing, download your file with one click — nothing is stored on our servers. Your data stays private.",
    highlight: "download",
  },
];

export default function Onboarding() {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_KEY);
    if (!seen) {
      // Delay so the page renders first
      const timer = setTimeout(() => {
        setVisible(true);
        setEntering(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, []);

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
    <div
      className={`fixed bottom-6 right-6 z-[90] max-w-xs transition-all duration-300 ${
        entering ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      <div className="rounded-2xl border border-cyan-200 bg-white px-5 py-4 shadow-[0_16px_40px_-14px_rgba(6,182,212,0.4)] dark:border-cyan-700 dark:bg-slate-900">
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
  );
}

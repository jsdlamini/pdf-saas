"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { LatexEditor } from "./latex-editor";
import { trackEvent } from "./analytics";
import { LEARN_LESSONS, LEARN_SECTIONS, type LearnLanguage } from "@/lib/learn-curriculum";

function normalize(s: string): string {
  return s.replace(/\r/g, "").trim();
}

function CheckIcon({ size = 12, color = "#34d399" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 20 20" style={{ width: size, height: size }} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

function StarIcon({ size = 12, color = "#fbbf24" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 20 20" style={{ width: size, height: size }} fill={color}>
      <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.9L10 15l-5.2 2.7 1-5.9L1.5 7.7l5.9-.9L10 1.5z" />
    </svg>
  );
}

const GUEST_CHALLENGE_LIMIT = 5;

export function LearnStudio({ onBack, isSignedIn, userId }: { onBack: () => void; isSignedIn: boolean; userId?: string | null }) {
  const [language, setLanguage] = useState<LearnLanguage>("python");
  const [lessonId, setLessonId] = useState("py-hello");
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [code, setCode] = useState("");
  const [output, setOutput] = useState("");
  const [feedback, setFeedback] = useState("");
  const [running, setRunning] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [solved, setSolved] = useState<string[]>([]);
  const [lastSolveDate, setLastSolveDate] = useState("");
  const [streak, setStreak] = useState(0);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    try {
      const next = localStorage.getItem("wiserfiles-learn-solved");
      const prev = localStorage.getItem("wiserfiles-learn-done");
      const parsed = next ? JSON.parse(next) : prev ? JSON.parse(prev) : [];
      if (Array.isArray(parsed)) setSolved(parsed.filter((x: unknown) => typeof x === "string"));
      setLastSolveDate(localStorage.getItem("wiserfiles-learn-lastdate") || "");
      setStreak(Number(localStorage.getItem("wiserfiles-learn-streak") || "0") || 0);
    } catch {}
  }, []);

  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 820);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("wiserfiles-learn-solved", JSON.stringify(solved)); } catch {}
  }, [solved]);

  const lessons = useMemo(
    () => LEARN_SECTIONS.find((s) => s.language === language)?.lessons ?? [],
    [language]
  );
  const lesson = lessons.find((l) => l.id === lessonId) ?? lessons[0];
  const challenges = lesson?.challenges ?? [];
  const currentChallenge = challenges[challengeIndex];

  useEffect(() => {
    const target = lessons.find((l) => l.id === lessonId) ?? lessons[0];
    if (target && target.challenges[challengeIndex]) {
      setCode(target.challenges[challengeIndex].starter);
      setOutput("");
      setFeedback("");
      setShowHint(false);
    }
  }, [language, lessonId, challengeIndex, lessons]);

  const lessonIndex = lesson ? lessons.findIndex((l) => l.id === lesson.id) : -1;
  const firstWordIndex = challenges.findIndex((c) => c.kind === "word");

  function solvedKey(lid: string, idx: number) {
    return `${lid}:${idx}`;
  }
  function isSolved(lid: string, idx: number) {
    return solved.includes(solvedKey(lid, idx));
  }

  const lessonSolvedCount = lesson
    ? lesson.challenges.filter((_, i) => isSolved(lesson.id, i)).length
    : 0;
  const lessonComplete = lesson ? lessonSolvedCount === lesson.challenges.length : false;

  const totalChallenges = useMemo(
    () => lessons.reduce((n, l) => n + l.challenges.length, 0),
    [lessons]
  );
  const totalSolved = solved.length;
  const progressPct = totalChallenges ? Math.round((totalSolved / totalChallenges) * 100) : 0;

  const totalXP = useMemo(() => {
    let xp = 0;
    for (const l of LEARN_LESSONS) {
      for (let i = 0; i < l.challenges.length; i += 1) {
        if (solved.includes(`${l.id}:${i}`)) {
          xp += l.challenges[i].kind === "word" ? 25 : 10;
        }
      }
    }
    return xp;
  }, [solved]);
  const level = Math.floor(totalXP / 200) + 1;

  const requireRegister = !isSignedIn && totalSolved >= GUEST_CHALLENGE_LIMIT;

  function registerSolve() {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let nextStreak = streak;
    if (lastSolveDate === today) {
      // unchanged
    } else if (lastSolveDate === yesterday) {
      nextStreak = streak + 1;
    } else {
      nextStreak = 1;
    }
    setStreak(nextStreak);
    setLastSolveDate(today);
    try {
      localStorage.setItem("wiserfiles-learn-lastdate", today);
      localStorage.setItem("wiserfiles-learn-streak", String(nextStreak));
    } catch {}
  }

  function selectLanguage(lang: LearnLanguage) {
    setLanguage(lang);
    const first = LEARN_SECTIONS.find((s) => s.language === lang)?.lessons[0];
    if (first) setLessonId(first.id);
    setChallengeIndex(0);
  }

  function selectLesson(id: string) {
    setLessonId(id);
    setChallengeIndex(0);
  }

  async function runCode() {
    if (!lesson || !currentChallenge) return;
    setRunning(true);
    setOutput("");
    setFeedback("");
    try {
      const mainPath = language === "python" ? "main.py" : "main.cpp";
      const res = await fetch("/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, files: [{ path: mainPath, content: code }], mainPath }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setOutput(data?.error || "Failed to run code.");
      } else {
        setOutput(data?.output != null && data.output !== "" ? data.output : "(no output)");
      }
    } catch {
      setOutput("Could not reach the code runner. Is the sandbox running?");
    } finally {
      setRunning(false);
    }
  }

  async function checkCode() {
    if (!lesson || !currentChallenge || requireRegister) return;
    setRunning(true);
    setFeedback("");
    try {
      const mainPath = language === "python" ? "main.py" : "main.cpp";
      const res = await fetch("/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, files: [{ path: mainPath, content: code }], mainPath }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setOutput(data?.error || "Failed to run code.");
        return;
      }
      const out = data?.output != null ? String(data.output) : "";
      setOutput(out || "(no output)");
      if (normalize(out) === normalize(currentChallenge.expectedOutput)) {
        setFeedback(`Solved — +${currentChallenge.kind === "word" ? 25 : 10} XP`);
        const key = solvedKey(lesson.id, challengeIndex);
        const isNewSolve = !solved.includes(key);
        if (isNewSolve) {
          setSolved((s) => [...s, key]);
          registerSolve();
          trackEvent("learn-solve", { userId: userId || "guest", detail: `${lesson.id}:${challengeIndex}` });
          if (lessonSolvedCount + 1 === lesson.challenges.length) {
            trackEvent("learn-lesson-complete", { userId: userId || "guest", detail: lesson.id });
          }
        }
        if (challengeIndex + 1 < lesson.challenges.length) {
          setChallengeIndex(challengeIndex + 1);
        }
      } else {
        setFeedback("Not quite. Compare with the expected output and try again.");
      }
    } catch {
      setOutput("Could not reach the code runner. Is the sandbox running?");
    } finally {
      setRunning(false);
    }
  }

  function nextChallenge() {
    if (challengeIndex + 1 < challenges.length) setChallengeIndex(challengeIndex + 1);
  }
  function prevChallenge() {
    if (challengeIndex > 0) setChallengeIndex(challengeIndex - 1);
  }
  function resetCode() {
    if (currentChallenge) setCode(currentChallenge.starter);
    setOutput("");
    setFeedback("");
    setShowHint(false);
  }

  const border = "var(--border-color, #334155)";
  const muted = "var(--text-muted, #64748b)";
  const primary = "var(--text-primary, #e2e8f0)";
  const bg = "var(--bg-primary, #0b0f19)";
  const bg2 = "var(--bg-secondary, #131620)";

  // Lesson content pane
  const contentPane = lesson ? (
    <>
      <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>{lesson.title}</h2>
      <div className="challenge-markdown" style={{ fontSize: 13.5, lineHeight: 1.65 }}>
        <ReactMarkdown>{lesson.explanation}</ReactMarkdown>
      </div>
      <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: muted, margin: "18px 0 8px" }}>
        Example
      </h3>
      <pre style={{ background: "#0d1117", border: `1px solid ${border}`, borderRadius: 8, padding: "12px 14px", overflowX: "auto", fontSize: 12.5, color: "#c9d1d9", fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>
        {lesson.example}
      </pre>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 10px" }}>
        <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: muted, margin: 0 }}>
          Challenges
        </h3>
        <span style={{ fontSize: 11, fontWeight: 700, color: lessonComplete ? "#34d399" : muted }}>
          {lessonSolvedCount}/{challenges.length} solved{lessonComplete ? " — complete" : ""}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {challenges.slice(0, firstWordIndex < 0 ? challenges.length : firstWordIndex).map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setChallengeIndex(i)}
            style={{
              minWidth: 34, height: 30, padding: "0 8px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: i === challengeIndex ? "1px solid rgba(16,185,129,0.6)" : `1px solid ${border}`,
              background: isSolved(lesson.id, i) ? "rgba(52,211,153,0.15)" : i === challengeIndex ? "rgba(16,185,129,0.12)" : "transparent",
              color: isSolved(lesson.id, i) ? "#34d399" : i === challengeIndex ? "#5eead4" : primary,
            }}
          >
            {i + 1}{isSolved(lesson.id, i) ? " ✓" : ""}
          </button>
        ))}
        {firstWordIndex >= 0 ? (
          <div style={{ flexBasis: "100%", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#f59e0b", margin: "4px 0 0" }}>
            Real-life problems
          </div>
        ) : null}
        {firstWordIndex >= 0
          ? challenges.slice(firstWordIndex).map((c, i) => {
              const idx = firstWordIndex + i;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setChallengeIndex(idx)}
                  style={{
                    minWidth: 34, height: 30, padding: "0 8px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    border: idx === challengeIndex ? "1px solid rgba(245,158,11,0.6)" : `1px solid ${border}`,
                    background: isSolved(lesson.id, idx) ? "rgba(52,211,153,0.15)" : idx === challengeIndex ? "rgba(245,158,11,0.12)" : "transparent",
                    color: isSolved(lesson.id, idx) ? "#34d399" : idx === challengeIndex ? "#fbbf24" : primary,
                  }}
                >
                  {i + 1}{isSolved(lesson.id, idx) ? " ✓" : ""}
                </button>
              );
            })
          : null}
      </div>

      <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "12px 14px" }}>
        <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: currentChallenge?.kind === "word" ? "#fbbf24" : "#5eead4" }}>
          {currentChallenge?.kind === "word" ? "Real-life problem" : `Question ${challengeIndex + 1}`}
        </p>
        <div className="challenge-markdown" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          <ReactMarkdown>{currentChallenge?.prompt}</ReactMarkdown>
        </div>
        {currentChallenge?.hint ? (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setShowHint((v) => !v)}
              style={{ fontSize: 11, fontWeight: 600, cursor: "pointer", background: "none", border: "none", color: "#60a5fa", padding: 0 }}
            >
              {showHint ? "Hide hint" : "Show hint"}
            </button>
            {showHint ? (
              <p style={{ fontSize: 12, color: muted, margin: "6px 0 0", fontStyle: "italic" }}>{currentChallenge.hint}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  ) : (
    <p style={{ color: muted }}>Select a lesson to begin.</p>
  );

  // Editor + controls + output pane
  const editorPane = (
    <>
      <div style={{ flex: 1, minHeight: 0, background: "#0d0f17" }}>
        <LatexEditor
          value={code}
          onChange={setCode}
          language={language}
          theme="dark"
          className="studio-editor-codemirror"
        />
      </div>
      <div style={{ display: "flex", gap: 8, padding: "8px 10px", borderTop: `1px solid ${border}`, background: bg2, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={runCode}
          disabled={running}
          style={{ height: 30, padding: "0 14px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${border}`, cursor: "pointer", background: "transparent", color: primary }}
        >
          {running ? "Running…" : "Run"}
        </button>
        <button
          type="button"
          onClick={checkCode}
          disabled={running || requireRegister}
          style={{ height: 30, padding: "0 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: "pointer", background: requireRegister ? "#64748b" : "linear-gradient(135deg,#10b981,#14b8a6)", color: "#fff" }}
        >
          {running ? "Checking…" : "Check answer"}
        </button>
        <button type="button" onClick={resetCode} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 12, padding: "0 10px", cursor: "pointer" }}>
          Reset
        </button>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" onClick={prevChallenge} disabled={challengeIndex === 0} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 12, padding: "0 8px", cursor: "pointer" }}>‹</button>
          <span style={{ fontSize: 11, color: muted }}>{challengeIndex + 1}/{challenges.length}</span>
          <button type="button" onClick={nextChallenge} disabled={challengeIndex + 1 >= challenges.length} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 12, padding: "0 8px", cursor: "pointer" }}>›</button>
        </span>
      </div>
      <div style={{ height: 150, borderTop: `1px solid ${border}`, overflowY: "auto", background: "#0d1117", padding: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted, margin: "0 0 6px" }}>
            Output
          </p>
          {feedback ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: feedback.startsWith("Solved") ? "#34d399" : "#fca5a5" }}>{feedback}</span>
          ) : null}
        </div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#c9d1d9" }}>
          {output || "Write your solution and press Check answer."}
        </pre>
      </div>
    </>
  );

  return (
    <main
      className="studio-dark"
      style={{ height: "100vh", display: "flex", flexDirection: "column", background: bg, color: primary, overflow: "hidden" }}
    >
      <header
        style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${border}`,
          background: "linear-gradient(120deg, rgba(79,70,229,0.16), rgba(20,184,166,0.14), transparent)",
        }}
      >
        <button type="button" onClick={onBack} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 12, padding: "0 10px", cursor: "pointer" }}>
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l-6 6 6 6" /></svg>
          Back
        </button>
        <span style={{ fontWeight: 800, fontSize: 15 }}>Learn to Code</span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 999, padding: "2px 10px" }}>
            Level {level}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 999, padding: "2px 10px" }}>
            <StarIcon size={11} /> {totalXP} XP
          </span>
          {streak > 0 ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#fb923c", background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 999, padding: "2px 10px" }}>
              {streak}-day streak
            </span>
          ) : null}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {(["python", "cpp"] as LearnLanguage[]).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => selectLanguage(lang)}
                style={{
                  height: 30, padding: "0 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", borderRadius: 8,
                  border: language === lang ? "none" : `1px solid ${border}`,
                  background: language === lang
                    ? (lang === "python" ? "linear-gradient(135deg,#10b981,#14b8a6)" : "linear-gradient(135deg,#f97316,#fb923c)")
                    : "transparent",
                  color: language === lang ? "#fff" : muted,
                }}
              >
                {lang === "python" ? "Python" : "C++"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div style={{ height: 4, background: "rgba(148,163,184,0.12)" }}>
        <div style={{ height: "100%", width: `${progressPct}%`, background: "linear-gradient(90deg,#10b981,#14b8a6)", transition: "width 0.3s ease" }} />
      </div>

      {isNarrow ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
          {/* horizontal lesson chips */}
          <div style={{ display: "flex", gap: 6, padding: 10, borderBottom: `1px solid ${border}`, overflowX: "auto", background: bg2 }}>
            {lessons.map((l, i) => {
              const doneCount = l.challenges.filter((_, idx) => isSolved(l.id, idx)).length;
              const complete = doneCount === l.challenges.length;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => selectLesson(l.id)}
                  style={{
                    flexShrink: 0, padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: l.id === lesson?.id ? "rgba(16,185,129,0.2)" : "transparent",
                    border: l.id === lesson?.id ? "1px solid rgba(16,185,129,0.5)" : `1px solid ${border}`,
                    color: l.id === lesson?.id ? "#5eead4" : primary,
                  }}
                >
                  {i + 1}. {l.title}{complete ? " ✓" : ""}
                </button>
              );
            })}
          </div>
          <div style={{ padding: 16, borderBottom: `1px solid ${border}` }}>{contentPane}</div>
          <div style={{ display: "flex", flexDirection: "column", minHeight: 420 }}>{editorPane}</div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <aside style={{ width: 240, overflowY: "auto", borderRight: `1px solid ${border}`, background: bg2, padding: 12 }}>
            {lessons.map((l, i) => {
              const active = l.id === lesson?.id;
              const doneCount = l.challenges.filter((_, idx) => isSolved(l.id, idx)).length;
              const complete = doneCount === l.challenges.length;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => selectLesson(l.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "9px 10px",
                    marginBottom: 4, borderRadius: 8, fontSize: 12.5, cursor: "pointer",
                    background: active ? "rgba(16,185,129,0.15)" : "transparent",
                    color: active ? "#5eead4" : primary,
                    border: active ? "1px solid rgba(16,185,129,0.4)" : "1px solid transparent",
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  <span style={{ fontSize: 11, color: muted, minWidth: 18 }}>{i + 1}.</span>
                  <span style={{ flex: 1 }}>{l.title}</span>
                  <span style={{ fontSize: 10, color: muted }}>{doneCount}/{l.challenges.length}</span>
                  {complete ? <CheckIcon size={12} /> : null}
                </button>
              );
            })}
          </aside>
          <section style={{ flex: 1, overflowY: "auto", padding: "20px 24px", minWidth: 0 }}>{contentPane}</section>
          <section style={{ width: 480, display: "flex", flexDirection: "column", borderLeft: `1px solid ${border}`, minWidth: 320 }}>{editorPane}</section>
        </div>
      )}

      {requireRegister ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(2,6,23,0.7)", padding: 20 }}>
          <div style={{ maxWidth: 420, width: "100%", background: bg2, border: `1px solid ${border}`, borderRadius: 14, padding: 26, textAlign: "center" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800 }}>Create a free account to continue</h3>
            <p style={{ fontSize: 13.5, color: muted, margin: "0 0 20px", lineHeight: 1.6 }}>
              You've solved {totalSolved} challenges. Sign up to keep your progress, XP, and streak saved across devices.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <SignUpButton mode="modal">
                <button className="studio-btn studio-btn-primary" style={{ height: 36, fontSize: 13 }}>Create account</button>
              </SignUpButton>
              <SignInButton mode="modal">
                <button className="studio-btn studio-btn-secondary" style={{ height: 36, fontSize: 13 }}>Sign in</button>
              </SignInButton>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

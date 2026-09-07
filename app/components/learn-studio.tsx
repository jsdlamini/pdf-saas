"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { LatexEditor } from "./latex-editor";
import { LEARN_SECTIONS, type LearnLanguage } from "@/lib/learn-curriculum";

function normalize(s: string): string {
  return s.replace(/\r/g, "").trim();
}

export function LearnStudio({ onBack }: { onBack: () => void }) {
  const [language, setLanguage] = useState<LearnLanguage>("python");
  const [lessonId, setLessonId] = useState("py-hello");
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [code, setCode] = useState("");
  const [output, setOutput] = useState("");
  const [feedback, setFeedback] = useState("");
  const [running, setRunning] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [solved, setSolved] = useState<string[]>([]);

  useEffect(() => {
    try {
      const next = localStorage.getItem("wiserfiles-learn-solved");
      const prev = localStorage.getItem("wiserfiles-learn-done");
      const parsed = next ? JSON.parse(next) : prev ? JSON.parse(prev) : [];
      if (Array.isArray(parsed)) setSolved(parsed.filter((x: unknown) => typeof x === "string"));
    } catch {}
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

  // Load the current challenge's starter whenever the lesson/challenge changes.
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

  const totalChallenges = lessons.reduce((n, l) => n + l.challenges.length, 0);
  const totalSolved = solved.length;

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
    if (!lesson || !currentChallenge) return;
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
        setFeedback("✅ Solved! Great work.");
        const key = solvedKey(lesson.id, challengeIndex);
        if (!solved.includes(key)) setSolved((s) => [...s, key]);
        if (challengeIndex + 1 < lesson.challenges.length) {
          setChallengeIndex(challengeIndex + 1);
        }
      } else {
        setFeedback("❌ Not quite. Compare with the expected output and try again.");
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

  return (
    <main
      className="studio-dark"
      style={{ height: "100vh", display: "flex", flexDirection: "column", background: bg, color: primary, overflow: "hidden" }}
    >
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${border}`, background: bg2 }}>
        <button type="button" onClick={onBack} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 12, padding: "0 10px", cursor: "pointer" }}>
          ← Back
        </button>
        <span style={{ fontWeight: 800, fontSize: 15 }}>Learn to Code</span>
        <span style={{ fontSize: 11, color: muted }}>{totalSolved}/{totalChallenges} challenges solved</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {(["python", "cpp"] as LearnLanguage[]).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => selectLanguage(lang)}
              style={{
                height: 30,
                padding: "0 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                borderRadius: 8,
                border: language === lang ? "none" : `1px solid ${border}`,
                background: language === lang ? "linear-gradient(135deg,#10b981,#14b8a6)" : "transparent",
                color: language === lang ? "#fff" : muted,
              }}
            >
              {lang === "python" ? "Python" : "C++"}
            </button>
          ))}
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Lesson list */}
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
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 10px",
                  marginBottom: 4,
                  borderRadius: 8,
                  fontSize: 12.5,
                  cursor: "pointer",
                  background: active ? "rgba(16,185,129,0.15)" : "transparent",
                  color: active ? "#5eead4" : primary,
                  border: active ? "1px solid rgba(16,185,129,0.4)" : "1px solid transparent",
                  fontWeight: active ? 700 : 500,
                }}
              >
                <span style={{ fontSize: 11, color: muted, minWidth: 18 }}>{i + 1}.</span>
                <span style={{ flex: 1 }}>{l.title}</span>
                <span style={{ fontSize: 10, color: muted }}>{doneCount}/{l.challenges.length}</span>
                {complete ? <span style={{ color: "#34d399", fontSize: 12 }}>✓</span> : null}
              </button>
            );
          })}
        </aside>

        {/* Lesson content */}
        <section style={{ flex: 1, overflowY: "auto", padding: "20px 24px", minWidth: 0 }}>
          {lesson ? (
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
                  🧩 Challenges
                </h3>
                <span style={{ fontSize: 11, fontWeight: 700, color: lessonComplete ? "#34d399" : muted }}>
                  {lessonSolvedCount}/{challenges.length} solved{lessonComplete ? " — complete! 🎉" : ""}
                </span>
              </div>

              {/* Challenge picker */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {challenges.map((c, i) => {
                  const done = isSolved(lesson.id, i);
                  const current = i === challengeIndex;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setChallengeIndex(i)}
                      style={{
                        minWidth: 34,
                        height: 30,
                        padding: "0 8px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        border: current ? "1px solid rgba(16,185,129,0.6)" : `1px solid ${border}`,
                        background: done ? "rgba(52,211,153,0.15)" : current ? "rgba(16,185,129,0.12)" : "transparent",
                        color: done ? "#34d399" : current ? "#5eead4" : primary,
                      }}
                    >
                      {i + 1}{done ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>

              {/* Current challenge prompt */}
              <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "12px 14px" }}>
                <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: "#5eead4" }}>
                  Question {challengeIndex + 1}
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
          )}
        </section>

        {/* Practice editor + run */}
        <section style={{ width: 480, display: "flex", flexDirection: "column", borderLeft: `1px solid ${border}`, minWidth: 320 }}>
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
              {running ? "Running…" : "▶ Run"}
            </button>
            <button
              type="button"
              onClick={checkCode}
              disabled={running}
              style={{ height: 30, padding: "0 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: "pointer", background: "#10b981", color: "#fff" }}
            >
              {running ? "Checking…" : "✓ Check"}
            </button>
            <button type="button" onClick={resetCode} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 12, padding: "0 10px", cursor: "pointer" }}>
              Reset
            </button>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              <button type="button" onClick={prevChallenge} disabled={challengeIndex === 0} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 12, padding: "0 8px", cursor: "pointer" }}>←</button>
              <span style={{ fontSize: 11, color: muted }}>Q {challengeIndex + 1}/{challenges.length}</span>
              <button type="button" onClick={nextChallenge} disabled={challengeIndex + 1 >= challenges.length} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 12, padding: "0 8px", cursor: "pointer" }}>→</button>
            </span>
          </div>
          <div style={{ height: 150, borderTop: `1px solid ${border}`, overflowY: "auto", background: "#0d1117", padding: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted, margin: "0 0 6px" }}>
                Output
              </p>
              {feedback ? (
                <span style={{ fontSize: 11, fontWeight: 700, color: feedback.startsWith("✅") ? "#34d399" : "#fca5a5" }}>{feedback}</span>
              ) : null}
            </div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#c9d1d9" }}>
              {output || "Write your solution and press ✓ Check."}
            </pre>
          </div>
        </section>
      </div>
    </main>
  );
}

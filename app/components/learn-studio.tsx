"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { LatexEditor } from "./latex-editor";
import { LEARN_SECTIONS, type LearnLanguage } from "@/lib/learn-curriculum";

export function LearnStudio({ onBack }: { onBack: () => void }) {
  const [language, setLanguage] = useState<LearnLanguage>("python");
  const [lessonId, setLessonId] = useState("py-hello");
  const [code, setCode] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("wiserfiles-learn-done") || "[]");
      if (Array.isArray(saved)) setDone(saved.filter((x: unknown) => typeof x === "string"));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("wiserfiles-learn-done", JSON.stringify(done)); } catch {}
  }, [done]);

  const lessons = useMemo(
    () => LEARN_SECTIONS.find((s) => s.language === language)?.lessons ?? [],
    [language]
  );
  const lesson = lessons.find((l) => l.id === lessonId) ?? lessons[0];

  useEffect(() => {
    const target = lessons.find((l) => l.id === lessonId) ?? lessons[0];
    if (target) {
      setCode(target.starter);
      setOutput("");
    }
  }, [language, lessonId, lessons]);

  const lessonIndex = lesson ? lessons.findIndex((l) => l.id === lesson.id) : -1;
  const doneCount = lessons.filter((l) => done.includes(l.id)).length;

  async function runCode() {
    if (!lesson) return;
    setRunning(true);
    setOutput("");
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
      if (!done.includes(lesson.id)) setDone((d) => [...d, lesson.id]);
    } catch {
      setOutput("Could not reach the code runner. Is the sandbox running?");
    } finally {
      setRunning(false);
    }
  }

  function nextLesson() {
    if (lessonIndex >= 0 && lessonIndex < lessons.length - 1) {
      setLessonId(lessons[lessonIndex + 1].id);
    }
  }

  function resetCode() {
    if (lesson) setCode(lesson.starter);
    setOutput("");
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
        <button type="button" onClick={onBack} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 12, padding: "0 10px" }}>
          ← Back
        </button>
        <span style={{ fontWeight: 800, fontSize: 15 }}>Learn to Code</span>
        <span style={{ fontSize: 11, color: muted }}>Beginner Python &amp; C++ — practice right in the editor</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: muted, marginRight: 4 }}>
            {doneCount}/{lessons.length} done
          </span>
          {(["python", "cpp"] as LearnLanguage[]).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setLanguage(lang)}
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
            const complete = done.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setLessonId(l.id)}
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
              <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: muted, margin: "18px 0 8px" }}>
                Your turn
              </h3>
              <div className="challenge-markdown" style={{ fontSize: 13.5, lineHeight: 1.65 }}>
                <ReactMarkdown>{lesson.task}</ReactMarkdown>
              </div>
              {lesson.expectedOutput ? (
                <p style={{ fontSize: 12, color: muted, marginTop: 10 }}>
                  Expected output: <code style={{ color: "#34d399", fontFamily: "var(--font-mono)" }}>{lesson.expectedOutput}</code>
                </p>
              ) : null}
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
          <div style={{ display: "flex", gap: 8, padding: "8px 10px", borderTop: `1px solid ${border}`, background: bg2, alignItems: "center" }}>
            <button
              type="button"
              onClick={runCode}
              disabled={running}
              style={{ height: 30, padding: "0 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: "pointer", background: "#10b981", color: "#fff" }}
            >
              {running ? "Running…" : "▶ Run"}
            </button>
            <button type="button" onClick={resetCode} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 12, padding: "0 10px" }}>
              Reset
            </button>
            <button
              type="button"
              onClick={nextLesson}
              disabled={lessonIndex >= lessons.length - 1}
              className="studio-btn studio-btn-ghost"
              style={{ height: 30, fontSize: 12, padding: "0 10px", marginLeft: "auto" }}
            >
              Next →
            </button>
          </div>
          <div style={{ height: 150, borderTop: `1px solid ${border}`, overflowY: "auto", background: "#0d1117", padding: 10 }}>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted, margin: "0 0 6px" }}>
              Output
            </p>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#c9d1d9" }}>
              {output || "Run your code to see the output here."}
            </pre>
          </div>
        </section>
      </div>
    </main>
  );
}

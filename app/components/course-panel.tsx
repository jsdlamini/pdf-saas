"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showToast } from "@/app/components/toast";
import CourseGroupsPanel from "@/app/components/course-groups-panel";

const QRCodeSVG = dynamic(() => import("qrcode.react").then((m) => m.QRCodeSVG), { ssr: false });

type Course = {
  id: number;
  code: string;
  title: string;
  institution: string;
  owner_id: string;
  cohort_id: number | null;
  member_count: number;
  my_role: string | null;
  is_owner: boolean;
  is_teacher: boolean;
  join_code: string | null;
};

type CourseProject = {
  id: string;
  name: string;
  updatedAt: string;
  courseId: number | null;
  editorMode?: string;
};

function siteOrigin() {
  return (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
}

function joinUrl(code: string) {
  return `${siteOrigin()}/join?code=${encodeURIComponent(code)}`;
}

export default function CoursePanel() {
  const { isLoaded, isSignedIn } = useAuth();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [projects, setProjects] = useState<CourseProject[]>([]);
  const [error, setError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const [formCode, setFormCode] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formInstitution, setFormInstitution] = useState("");
  const [formError, setFormError] = useState("");
  const [formBusy, setFormBusy] = useState(false);

  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cRes, pRes] = await Promise.all([
        fetch("/api/courses", { cache: "no-store" }),
        fetch("/api/research-projects", { cache: "no-store" }),
      ]);
      if (cRes.ok) {
        const json = await cRes.json();
        setCourses(Array.isArray(json.courses) ? json.courses : []);
        setCanCreate(Boolean(json.canCreate));
        setError("");
      } else {
        setError("Could not load your courses.");
        return;
      }
      if (pRes.ok) {
        const json = (await pRes.json()) as {
          projects?: Array<{ id: string; name: string; updatedAt: string; courseId?: number | null; editorMode?: string }>;
        };
        const list = Array.isArray(json.projects) ? json.projects : [];
        setProjects(
          list.map((p) => ({
            id: p.id,
            name: p.name,
            updatedAt: p.updatedAt,
            courseId: typeof p.courseId === "number" ? p.courseId : null,
            editorMode: p.editorMode,
          }))
        );
      }
    } catch {
      setError("Could not load your courses.");
    }
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;
    // Fetch-on-mount is intentional; results land in async callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [isSignedIn, load]);

  async function createCourse() {
    const code = formCode.trim();
    const title = formTitle.trim();
    if (!code || !title) {
      setFormError("Course code and title are required.");
      return;
    }
    setFormBusy(true);
    setFormError("");
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", code, title, institution: formInstitution.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(json?.error || "Could not create the course.");
        return;
      }
      setCreateOpen(false);
      setFormCode("");
      setFormTitle("");
      setFormInstitution("");
      showToast("Course created", "success");
      await load();
    } catch {
      setFormError("Could not create the course.");
    } finally {
      setFormBusy(false);
    }
  }

  async function joinCourse() {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) {
      setJoinError("Enter a join code.");
      return;
    }
    setJoinBusy(true);
    setJoinError("");
    try {
      const res = await fetch("/api/cohorts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", joinCode: code }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setJoinError(json?.error || "Could not join this course.");
        return;
      }
      setJoinOpen(false);
      setJoinCodeInput("");
      showToast("Joined course", "success");
      await load();
    } catch {
      setJoinError("Could not join this course.");
    } finally {
      setJoinBusy(false);
    }
  }

  async function regenerateLink(course: Course) {
    if (!window.confirm(`Regenerate the join link for "${course.title}"? The old link will stop working, but existing members stay enrolled.`)) return;
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate-join-code", courseId: course.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(json?.error || "Could not regenerate the link.", "error");
        return;
      }
      showToast("Join link regenerated", "success");
      await load();
    } catch {
      showToast("Could not regenerate the link.", "error");
    }
  }

  async function disableLink(course: Course) {
    if (!window.confirm(`Disable the join link for "${course.title}"? No one new will be able to join until you regenerate it.`)) return;
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke-join", courseId: course.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(json?.error || "Could not disable the link.", "error");
        return;
      }
      showToast("Join link disabled", "success");
      await load();
    } catch {
      showToast("Could not disable the link.", "error");
    }
  }

  function toggleReveal(id: number) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyLink(code: string) {
    try {
      await navigator.clipboard.writeText(joinUrl(code));
      showToast("Join link copied", "success");
    } catch {
      showToast("Could not copy the link.", "error");
    }
  }

  if (!isLoaded) {
    return (
      <section style={{ border: "1px solid var(--border-color, #334155)", borderRadius: 12, background: "var(--bg-secondary, #131620)", padding: 16 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>Loading courses…</p>
      </section>
    );
  }

  const headerActions = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {canCreate ? (
        <button type="button" className="studio-btn studio-btn-primary" onClick={() => { setFormError(""); setCreateOpen(true); }}>
          Create course
        </button>
      ) : null}
      <button type="button" className="studio-btn studio-btn-secondary" onClick={() => { setJoinError(""); setJoinOpen(true); }}>
        Join with a link
      </button>
    </div>
  );

  return (
    <section style={{ border: "1px solid var(--border-color, #334155)", borderRadius: 12, background: "var(--bg-secondary, #131620)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--border-color, #334155)", background: "linear-gradient(120deg, rgba(45,212,191,0.12), transparent)" }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary, #e2e8f0)", margin: 0 }}>My Courses</h2>
          <p style={{ fontSize: 11.5, color: "var(--text-muted, #64748b)", margin: "2px 0 0" }}>
            {courses === null ? "" : `${courses.length} course${courses.length === 1 ? "" : "s"}${canCreate ? " · teaching" : ""}`}
          </p>
        </div>
        {isSignedIn ? headerActions : null}
      </div>

      <div style={{ padding: 12 }}>
        {!isSignedIn ? (
          <p style={{ fontSize: 12.5, color: "var(--text-muted, #64748b)", padding: "8px 4px" }}>Sign in to see your courses.</p>
        ) : error ? (
          <p style={{ fontSize: 12.5, color: "var(--danger, #f87171)", padding: "8px 4px" }}>{error}</p>
        ) : courses === null ? (
          <p style={{ fontSize: 12.5, color: "var(--text-muted, #64748b)", padding: "8px 4px" }}>Loading courses…</p>
        ) : courses && courses.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 12px" }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary, #e2e8f0)", marginBottom: 4 }}>No courses yet</p>
            <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 12 }}>
              {canCreate ? "Create a course and share its join link, or join one with a code." : "Join a course with the link or code your teacher shared."}
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>{headerActions}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {(courses || []).map((course) => {
              const isRevealed = revealed.has(course.id);
              const courseProjects = projects.filter((p) => p.courseId === course.id);
              return (
                <article key={course.id} style={{ border: "1px solid var(--border-color, #334155)", borderRadius: 10, background: "var(--bg-primary, #0f1117)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary, #e2e8f0)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{course.title}</p>
                      <p style={{ fontSize: 11.5, color: "var(--text-muted, #64748b)", margin: "2px 0 0" }}>
                        {course.code}{course.institution ? ` · ${course.institution}` : ""}
                      </p>
                    </div>
                    {course.is_teacher ? (
                      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "rgba(45,212,191,0.15)", color: "#2dd4bf" }}>Teaching</span>
                    ) : (
                      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "rgba(129,140,248,0.15)", color: "#818cf8" }}>Enrolled</span>
                    )}
                  </div>

                  <p style={{ fontSize: 11, color: "var(--text-muted, #64748b)", margin: 0 }}>
                    {course.member_count} member{course.member_count === 1 ? "" : "s"}
                    {course.my_role === "lecturer" ? " · lecturer" : course.my_role === "assistant" ? " · assistant" : ""}
                  </p>

                  {course.is_teacher ? (
                    <div style={{ borderTop: "1px solid var(--border-color, #334155)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                      {course.join_code ? (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => toggleReveal(course.id)}
                              className="studio-btn studio-btn-secondary"
                              style={{ height: "auto", padding: "4px 10px", fontSize: 11 }}
                            >
                              {isRevealed ? "Hide link" : "Reveal link"}
                            </button>
                            {isRevealed ? (
                              <span style={{ fontFamily: "monospace", fontSize: 11.5, color: "var(--text-primary, #e2e8f0)" }}>{course.join_code}</span>
                            ) : null}
                            {isRevealed ? (
                              <button type="button" onClick={() => copyLink(course.join_code!)} className="studio-btn studio-btn-secondary" style={{ height: "auto", padding: "4px 10px", fontSize: 11 }}>Copy</button>
                            ) : null}
                          </div>
                          {isRevealed ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <QRCodeSVG value={joinUrl(course.join_code!)} size={76} bgColor="#ffffff" fgColor="#000000" title="Scan to join" />
                              <div style={{ fontSize: 10.5, color: "var(--text-muted, #64748b)", lineHeight: 1.5 }}>
                                Scan or share the link to enrol students.
                                <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
                                  <button type="button" className="studio-btn studio-btn-secondary" style={{ height: "auto", padding: "3px 8px", fontSize: 11 }} onClick={() => regenerateLink(course)}>Regenerate link</button>
                                  <button type="button" className="studio-btn studio-btn-secondary" style={{ height: "auto", padding: "3px 8px", fontSize: 11 }} onClick={() => disableLink(course)}>Disable link</button>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div style={{ fontSize: 11, color: "var(--text-muted, #64748b)" }}>
                          Join link disabled.
                          <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                            <button type="button" className="studio-btn studio-btn-secondary" style={{ height: "auto", padding: "3px 8px", fontSize: 11 }} onClick={() => regenerateLink(course)}>Generate link</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {course.code === "CSC111" ? (
                    <div style={{ borderTop: "1px solid var(--border-color, #334155)", paddingTop: 8 }}>
                      <CourseGroupsPanel courseId={course.id} courseCode={course.code} />
                    </div>
                  ) : null}

                  {courseProjects.length > 0 ? (
                    <div style={{ borderTop: "1px solid var(--border-color, #334155)", paddingTop: 8 }}>
                      <p style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted, #64748b)", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Projects · {courseProjects.length}
                      </p>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                        {courseProjects.map((p) => (
                          <li key={p.id}>
                            <a href="/research-studio" style={{ fontSize: 12, color: "var(--text-primary, #e2e8f0)", textDecoration: "none", display: "flex", justifyContent: "space-between", gap: 8 }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                              <span style={{ flexShrink: 0, fontSize: 10.5, color: "var(--text-muted, #64748b)" }}>{new Date(p.updatedAt).toLocaleDateString()}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Create course dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setFormError(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create a course</DialogTitle>
            <DialogDescription>Teachers can create courses and share a join link with students.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="course-code">Course code</Label>
              <Input id="course-code" value={formCode} onChange={(e) => { setFormCode(e.target.value); setFormError(""); }} placeholder="e.g. CSC111" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-title">Course title</Label>
              <Input id="course-title" value={formTitle} onChange={(e) => { setFormTitle(e.target.value); setFormError(""); }} placeholder="e.g. Introduction to Computer Science" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-institution">Institution (optional)</Label>
              <Input id="course-institution" value={formInstitution} onChange={(e) => setFormInstitution(e.target.value)} placeholder="e.g. UNESWA" />
            </div>
            {formError ? <p className="text-xs font-semibold text-[var(--danger,#ef4444)]">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createCourse} disabled={formBusy}>{formBusy ? "Creating…" : "Create course"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Join dialog */}
      <Dialog open={joinOpen} onOpenChange={(open) => { setJoinOpen(open); if (!open) setJoinError(""); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Join a course</DialogTitle>
            <DialogDescription>Paste the join code or link your teacher shared with you.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="join-code">Join code</Label>
              <Input id="join-code" value={joinCodeInput} onChange={(e) => { setJoinCodeInput(e.target.value); setJoinError(""); }} placeholder="e.g. A1B2C3D4" className="uppercase" autoFocus />
            </div>
            {joinError ? <p className="text-xs font-semibold text-[var(--danger,#ef4444)]">{joinError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJoinOpen(false)}>Cancel</Button>
            <Button onClick={joinCourse} disabled={joinBusy}>{joinBusy ? "Joining…" : "Join course"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

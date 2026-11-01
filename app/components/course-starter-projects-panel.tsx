"use client";

import { useCallback, useEffect, useState } from "react";
import { showToast } from "@/app/components/toast";

type StarterProject = {
  id: string;
  name: string;
  updatedAt: string;
  courseId: number | null;
  editorMode: string;
  isOwner: boolean;
};

export default function CourseStarterProjectsPanel({
  courseId,
  isTeacher,
}: {
  courseId: number;
  isTeacher: boolean;
}) {
  const [projects, setProjects] = useState<StarterProject[] | null>(null);
  const [error, setError] = useState("");
  const [forkBusyId, setForkBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/starter-projects?courseId=${courseId}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || "Could not load starter projects.");
        setProjects([]);
        return;
      }
      setProjects(Array.isArray(json.starterProjects) ? json.starterProjects : []);
      setError("");
    } catch {
      setError("Could not load starter projects.");
      setProjects([]);
    }
  }, [courseId]);

  useEffect(() => {
    // Fetch-on-mount is intentional; results land in async callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function addStarter() {
    window.location.assign(`/research-studio?newProject=1&courseId=${encodeURIComponent(courseId)}`);
  }

  function openProject(projectId: string) {
    window.location.assign(`/research-studio?project=${encodeURIComponent(projectId)}`);
  }

  async function forkProject(project: StarterProject) {
    if (forkBusyId) return;
    setForkBusyId(project.id);
    try {
      const res = await fetch("/api/courses/starter-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fork", courseId, projectId: project.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(json?.error || "Could not copy this project.", "error");
        return;
      }
      showToast("Project copied to your projects", "success");
      openProject(json.project?.id || project.id);
    } catch {
      showToast("Could not copy this project.", "error");
    } finally {
      setForkBusyId(null);
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--border-color, #334155)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <p style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted, #64748b)", margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Starter projects{projects ? ` · ${projects.length}` : ""}
        </p>
        {isTeacher ? (
          <button type="button" className="studio-btn studio-btn-yellow" style={{ height: "auto", padding: "4px 10px", fontSize: 11 }} onClick={addStarter}>
            Add starter project
          </button>
        ) : null}
      </div>

      {error ? (
        <p style={{ fontSize: 11.5, color: "var(--danger, #f87171)", margin: 0 }}>{error}</p>
      ) : projects === null ? (
        <p style={{ fontSize: 11.5, color: "var(--text-muted, #64748b)", margin: 0 }}>Loading…</p>
      ) : projects.length === 0 ? (
        <p style={{ fontSize: 11.5, color: "var(--text-muted, #64748b)", margin: 0 }}>
          {isTeacher ? "No starter projects yet — add one for your students." : "No starter projects yet."}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {projects.map((p) => (
            <li key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              {isTeacher && p.isOwner ? (
                <a
                  href={`/research-studio?project=${encodeURIComponent(p.id)}`}
                  onClick={(e) => { e.preventDefault(); openProject(p.id); }}
                  style={{ fontSize: 12, color: "var(--text-primary, #e2e8f0)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={p.name}
                >
                  {p.name}
                </a>
              ) : (
                <span style={{ fontSize: 12, color: "var(--text-primary, #e2e8f0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>
                  {p.name}
                </span>
              )}
              <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10.5, color: "var(--text-muted, #64748b)" }}>{new Date(p.updatedAt).toLocaleDateString()}</span>
                {isTeacher && p.isOwner ? (
                  <button type="button" className="studio-btn studio-btn-ghost" style={{ height: "auto", padding: "3px 8px", fontSize: 11 }} onClick={() => openProject(p.id)}>
                    Open
                  </button>
                ) : (
                  <button
                    type="button"
                    className="studio-btn studio-btn-primary"
                    style={{ height: "auto", padding: "3px 8px", fontSize: 11 }}
                    onClick={() => void forkProject(p)}
                    disabled={forkBusyId === p.id}
                  >
                    {forkBusyId === p.id ? "Copying…" : "Copy to my projects"}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

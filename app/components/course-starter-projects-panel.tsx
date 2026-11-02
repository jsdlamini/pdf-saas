"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          Starter projects{projects ? ` · ${projects.length}` : ""}
        </p>
        {isTeacher ? (
          <Button size="sm" onClick={addStarter}>
            Add starter project
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : projects === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {isTeacher ? "No starter projects yet — add one for your students." : "No starter projects yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-input bg-card px-3 py-2">
              {isTeacher && p.isOwner ? (
                <a
                  href={`/research-studio?project=${encodeURIComponent(p.id)}`}
                  onClick={(e) => { e.preventDefault(); openProject(p.id); }}
                  className="truncate text-sm text-foreground hover:underline"
                  title={p.name}
                >
                  {p.name}
                </a>
              ) : (
                <span className="truncate text-sm text-foreground" title={p.name}>
                  {p.name}
                </span>
              )}
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">{new Date(p.updatedAt).toLocaleDateString()}</span>
                {isTeacher && p.isOwner ? (
                  <Button variant="outline" size="sm" onClick={() => openProject(p.id)}>
                    Open
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void forkProject(p)} disabled={forkBusyId === p.id}>
                    {forkBusyId === p.id ? "Copying…" : "Copy to my projects"}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

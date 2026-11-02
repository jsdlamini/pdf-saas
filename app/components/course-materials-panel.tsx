"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/app/components/toast";

const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });

type MaterialKind = "note" | "link" | "video";

type Material = {
  id: number;
  course_id: number;
  author_id: string;
  kind: MaterialKind;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

const KINDS: MaterialKind[] = ["note", "link", "video"];

const KIND_LABELS: Record<MaterialKind, string> = {
  note: "Note",
  link: "Link",
  video: "Video",
};

// Convert a YouTube/Vimeo watch URL into an embeddable iframe src. Returns
// null when the host is not a known video host (callers then render a plain
// link instead of an embed).
function videoEmbed(url: string): { src: string; host: string } | null {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id) return { src: `https://www.youtube.com/embed/${id}`, host: "YouTube" };
    }
    if (host.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return { src: `https://www.youtube.com/embed/${id}`, host: "YouTube" };
    }
    if (host.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return { src: `https://player.vimeo.com/video/${id}`, host: "Vimeo" };
    }
  } catch {
    return null;
  }
  return null;
}

export default function CourseMaterialsPanel({
  courseId,
  isTeacher,
}: {
  courseId: number;
  isTeacher: boolean;
}) {
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftKind, setDraftKind] = useState<MaterialKind>("note");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/materials?courseId=${courseId}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || "Could not load materials.");
        setMaterials([]);
        return;
      }
      setMaterials(Array.isArray(json.materials) ? json.materials : []);
      setError("");
    } catch {
      setError("Could not load materials.");
      setMaterials([]);
    }
  }, [courseId]);

  useEffect(() => {
    // Fetch-on-mount is intentional; results land in async callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function openAdd() {
    setEditingId(null);
    setDraftKind("note");
    setDraftTitle("");
    setDraftBody("");
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(material: Material) {
    setEditingId(material.id);
    setDraftKind(material.kind);
    setDraftTitle(material.title);
    setDraftBody(material.body);
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setFormError("");
  }

  async function save() {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title) {
      setFormError("Title is required.");
      return;
    }
    if (draftKind !== "note" && !body) {
      setFormError("URL is required for links and videos.");
      return;
    }
    setFormBusy(true);
    setFormError("");
    try {
      const payload =
        editingId === null
          ? { action: "create", courseId, kind: draftKind, title, body }
          : { action: "update", courseId, materialId: editingId, kind: draftKind, title, body };
      const res = await fetch("/api/courses/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(json?.error || "Could not save the material.");
        return;
      }
      closeForm();
      showToast(editingId === null ? "Material added" : "Material updated", "success");
      await load();
    } catch {
      setFormError("Could not save the material.");
    } finally {
      setFormBusy(false);
    }
  }

  async function remove(material: Material) {
    if (!window.confirm(`Delete "${material.title}"?`)) return;
    try {
      const res = await fetch("/api/courses/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", courseId, materialId: material.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(json?.error || "Could not delete the material.", "error");
        return;
      }
      showToast("Material deleted", "success");
      await load();
    } catch {
      showToast("Could not delete the material.", "error");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          Materials · {materials === null ? "…" : materials.length}
        </p>
        {isTeacher ? (
          <Button
            variant={formOpen ? "outline" : "default"}
            size="sm"
            onClick={() => (formOpen ? closeForm() : openAdd())}
          >
            {formOpen ? "Cancel" : "+ Add material"}
          </Button>
        ) : null}
      </div>

      {formOpen && isTeacher ? (
        <div className="space-y-3 rounded-lg border border-input bg-muted/40 p-3">
          <div className="flex gap-2">
            {KINDS.map((kind) => (
              <Button
                key={kind}
                type="button"
                variant={draftKind === kind ? "default" : "outline"}
                size="sm"
                onClick={() => setDraftKind(kind)}
              >
                {KIND_LABELS[kind]}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`material-title-${courseId}`}>
              {draftKind === "note" ? "Title" : draftKind === "link" ? "Link title" : "Video title"}
            </Label>
            <Input
              id={`material-title-${courseId}`}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder={draftKind === "note" ? "e.g. Week 1 reading notes" : draftKind === "link" ? "e.g. Course handbook" : "e.g. Intro lecture"}
            />
          </div>
          {draftKind === "note" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`material-body-${courseId}`}>Note (markdown)</Label>
              <textarea
                id={`material-body-${courseId}`}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder="Write the note in markdown…"
                rows={4}
                className="w-full min-h-24 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:text-sm dark:bg-input/30"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor={`material-url-${courseId}`}>URL</Label>
              <Input
                id={`material-url-${courseId}`}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder={draftKind === "link" ? "https://…" : "YouTube or Vimeo URL (https://…)"}
              />
            </div>
          )}
          {formError ? <p className="text-xs font-semibold text-destructive">{formError}</p> : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={formBusy}>
              {formBusy ? "Saving…" : editingId === null ? "Add material" : "Save changes"}
            </Button>
            <Button variant="outline" size="sm" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : materials === null ? (
        <p className="text-xs text-muted-foreground">Loading materials…</p>
      ) : materials.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {isTeacher ? "No materials yet. Add a note, link, or video for your students." : "No materials yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {materials.map((material) => (
            <MaterialCard key={material.id} material={material} isTeacher={isTeacher} onEdit={() => openEdit(material)} onDelete={() => remove(material)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MaterialCard({
  material,
  isTeacher,
  onEdit,
  onDelete,
}: {
  material: Material;
  isTeacher: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const embed = material.kind === "video" ? videoEmbed(material.body) : null;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-input bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{KIND_LABELS[material.kind]}</Badge>
            {material.kind === "note" ? (
              <span className="text-xs text-muted-foreground">{new Date(material.updated_at).toLocaleDateString()}</span>
            ) : null}
          </div>
          <p className="mt-1.5 truncate text-sm font-semibold">{material.title}</p>
        </div>
        {isTeacher ? (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={onDelete}>
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      {material.kind === "note" ? (
        <div className="challenge-markdown text-sm leading-relaxed">
          <ReactMarkdown>{material.body || "_No content._"}</ReactMarkdown>
        </div>
      ) : material.kind === "link" ? (
        <a
          href={material.body}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 truncate text-sm text-primary hover:underline"
        >
          <svg viewBox="0 0 20 20" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 3h6v6M9 11L17 3M14 10v6H4V6h6" />
          </svg>
          <span className="truncate">{material.body}</span>
        </a>
      ) : embed ? (
        <div className="aspect-video overflow-hidden rounded-lg bg-black">
          <iframe src={embed.src} title={material.title} className="h-full w-full border-0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        </div>
      ) : (
        <a
          href={material.body}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 truncate text-sm text-primary hover:underline"
        >
          <svg viewBox="0 0 20 20" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 3h6v6M9 11L17 3M14 10v6H4V6h6" />
          </svg>
          <span className="truncate">Watch video · {material.body}</span>
        </a>
      )}
    </li>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
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
    <div style={{ borderTop: "1px solid var(--border-color, #334155)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <p style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted, #64748b)", margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Materials · {materials === null ? "…" : materials.length}
        </p>
        {isTeacher ? (
          <button
            type="button"
            className="studio-btn studio-btn-yellow"
            style={{ height: "auto", padding: "3px 8px", fontSize: 11 }}
            onClick={() => (formOpen ? closeForm() : openAdd())}
          >
            {formOpen ? "Cancel" : "+ Add material"}
          </button>
        ) : null}
      </div>

      {formOpen && isTeacher ? (
        <div style={{ border: "1px solid var(--border-color, #334155)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--bg-primary, #0f172a)" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setDraftKind(kind)}
                className={draftKind === kind ? "studio-btn studio-btn-yellow" : "studio-btn studio-btn-secondary"}
                style={{ height: "auto", padding: "3px 10px", fontSize: 11 }}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder={draftKind === "note" ? "Title" : draftKind === "link" ? "Link title" : "Video title"}
            style={{ background: "var(--bg-secondary, #131620)", border: "1px solid var(--border-color, #334155)", borderRadius: 6, color: "var(--text-primary, #e2e8f0)", padding: "6px 8px", fontSize: 12, width: "100%" }}
          />
          {draftKind === "note" ? (
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder="Write the note in markdown…"
              rows={4}
              style={{ background: "var(--bg-secondary, #131620)", border: "1px solid var(--border-color, #334155)", borderRadius: 6, color: "var(--text-primary, #e2e8f0)", padding: "6px 8px", fontSize: 12, width: "100%", resize: "vertical" }}
            />
          ) : (
            <input
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder={draftKind === "link" ? "https://…" : "YouTube or Vimeo URL (https://…)"}
              style={{ background: "var(--bg-secondary, #131620)", border: "1px solid var(--border-color, #334155)", borderRadius: 6, color: "var(--text-primary, #e2e8f0)", padding: "6px 8px", fontSize: 12, width: "100%" }}
            />
          )}
          {formError ? <p style={{ fontSize: 11, fontWeight: 600, color: "var(--danger, #ef4444)", margin: 0 }}>{formError}</p> : null}
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="studio-btn studio-btn-primary" style={{ height: "auto", padding: "4px 10px", fontSize: 11 }} onClick={save} disabled={formBusy}>
              {formBusy ? "Saving…" : editingId === null ? "Add material" : "Save changes"}
            </button>
            <button type="button" className="studio-btn studio-btn-secondary" style={{ height: "auto", padding: "4px 10px", fontSize: 11 }} onClick={closeForm}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p style={{ fontSize: 12, color: "var(--danger, #f87171)", margin: 0 }}>{error}</p>
      ) : materials === null ? (
        <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", margin: 0 }}>Loading materials…</p>
      ) : materials.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", margin: 0 }}>
          {isTeacher ? "No materials yet. Add a note, link, or video for your students." : "No materials yet."}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
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
    <li style={{ border: "1px solid var(--border-color, #334155)", borderRadius: 8, padding: 10, background: "var(--bg-primary, #0f172a)", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 999, background: "rgba(129,140,248,0.15)", color: "#818cf8" }}>
              {KIND_LABELS[material.kind]}
            </span>
            {material.kind === "note" ? (
              <span style={{ fontSize: 10, color: "var(--text-muted, #64748b)" }}>{new Date(material.updated_at).toLocaleDateString()}</span>
            ) : null}
          </div>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary, #e2e8f0)", margin: "4px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {material.title}
          </p>
        </div>
        {isTeacher ? (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button type="button" onClick={onEdit} className="studio-btn studio-btn-ghost" style={{ height: "auto", padding: "3px 8px", fontSize: 11 }} title="Edit material">
              Edit
            </button>
            <button type="button" onClick={onDelete} className="studio-btn studio-btn-danger" style={{ height: "auto", padding: "3px 8px", fontSize: 11 }} title="Delete material">
              Delete
            </button>
          </div>
        ) : null}
      </div>

      {material.kind === "note" ? (
        <div className="challenge-markdown" style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text-primary, #e2e8f0)" }}>
          <ReactMarkdown>{material.body || "_No content._"}</ReactMarkdown>
        </div>
      ) : material.kind === "link" ? (
        <a
          href={material.body}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: "#818cf8", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          <svg viewBox="0 0 20 20" style={{ width: 12, height: 12, flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 3h6v6M9 11L17 3M14 10v6H4V6h6" />
          </svg>
          <span>{material.body}</span>
        </a>
      ) : embed ? (
        <div style={{ borderRadius: 8, overflow: "hidden", background: "#000", aspectRatio: "16 / 9" }}>
          <iframe src={embed.src} title={material.title} style={{ width: "100%", height: "100%", border: 0 }} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        </div>
      ) : (
        <a
          href={material.body}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: "#818cf8", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          <svg viewBox="0 0 20 20" style={{ width: 12, height: 12, flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 3h6v6M9 11L17 3M14 10v6H4V6h6" />
          </svg>
          <span>Watch video · {material.body}</span>
        </a>
      )}
    </li>
  );
}

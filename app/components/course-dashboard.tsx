"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { showToast } from "@/app/components/toast";
import CourseMaterialsPanel from "@/app/components/course-materials-panel";
import CourseStarterProjectsPanel from "@/app/components/course-starter-projects-panel";
import CourseGroupsPanel from "@/app/components/course-groups-panel";

const QRCodeSVG = dynamic(() => import("qrcode.react").then((m) => m.QRCodeSVG), { ssr: false });

type CourseDashboardProps = {
  course: {
    id: number;
    code: string;
    title: string;
    institution: string;
  };
  memberCount: number;
  joinCode: string | null;
  isTeacher: boolean;
  role: string | null;
};

function siteOrigin() {
  return (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
}

function joinUrl(code: string) {
  return `${siteOrigin()}/join?code=${encodeURIComponent(code)}`;
}

export default function CourseDashboard({
  course,
  memberCount,
  joinCode: initialJoinCode,
  isTeacher,
  role,
}: CourseDashboardProps) {
  const [joinCode, setJoinCode] = useState<string | null>(initialJoinCode);
  const [revealed, setRevealed] = useState(false);

  async function regenerateLink() {
    if (
      !window.confirm(
        `Regenerate the join link for "${course.title}"? The old link will stop working, but existing members stay enrolled.`
      )
    )
      return;
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
      setJoinCode(json?.joinCode ?? null);
      setRevealed(true);
      showToast("Join link regenerated", "success");
    } catch {
      showToast("Could not regenerate the link.", "error");
    }
  }

  async function disableLink() {
    if (
      !window.confirm(
        `Disable the join link for "${course.title}"? No one new will be able to join until you regenerate it.`
      )
    )
      return;
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
      setJoinCode(null);
      setRevealed(false);
      showToast("Join link disabled", "success");
    } catch {
      showToast("Could not disable the link.", "error");
    }
  }

  async function copyLink() {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinUrl(joinCode));
      showToast("Join link copied", "success");
    } catch {
      showToast("Could not copy the link.", "error");
    }
  }

  const roleLabel =
    role === "lecturer" ? " · lecturer" : role === "assistant" ? " · assistant" : "";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-6 py-8 md:px-10">
      <Link
        href="/research-studio"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 10H5M9 6l-4 4 4 4" />
        </svg>
        Back to Research Studio
      </Link>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-input">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-xl font-semibold tracking-tight md:text-2xl">
                {course.title}
              </CardTitle>
              <CardDescription className="mt-1 text-sm">
                {course.code}
                {course.institution ? ` · ${course.institution}` : ""}
                {" · "}
                {memberCount} member{memberCount === 1 ? "" : "s"}
              </CardDescription>
            </div>
            <Badge variant={isTeacher ? "secondary" : "outline"} className="shrink-0">
              {isTeacher ? "Teaching" : "Enrolled"}
              {roleLabel}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 p-4 md:p-6">
          {isTeacher ? (
            <div className="space-y-3">
              <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                Join link
              </p>

              {joinCode ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="warning"
                      size="sm"
                      onClick={() => setRevealed((value) => !value)}
                    >
                      {revealed ? "Hide link" : "Reveal link"}
                    </Button>
                    {revealed ? <code className="text-xs font-semibold">{joinCode}</code> : null}
                    {revealed ? (
                      <Button variant="warning" size="sm" onClick={copyLink}>
                        Copy
                      </Button>
                    ) : null}
                  </div>

                  {revealed ? (
                    <div className="flex items-center gap-3">
                      <QRCodeSVG
                        value={joinUrl(joinCode)}
                        size={76}
                        bgColor="#ffffff"
                        fgColor="#000000"
                        title="Scan to join"
                        className="shrink-0 rounded border border-input"
                      />
                      <div className="space-y-2 text-xs text-muted-foreground">
                        <p className="leading-relaxed">Scan or share the link to enrol students.</p>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={regenerateLink}>
                            Regenerate link
                          </Button>
                          <Button variant="outline" size="sm" onClick={disableLink}>
                            Disable link
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>Join link disabled.</p>
                  <Button variant="warning" size="sm" onClick={regenerateLink}>
                    Generate link
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          <CourseMaterialsPanel courseId={course.id} isTeacher={isTeacher} />

          <CourseStarterProjectsPanel courseId={course.id} isTeacher={isTeacher} />

          {course.code === "CSC111" ? (
            <CourseGroupsPanel courseId={course.id} courseCode={course.code} />
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

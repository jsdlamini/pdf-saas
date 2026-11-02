"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  SettingsIcon,
  BookOpenIcon,
  FileTextIcon,
  FolderOpenIcon,
  UsersIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  RefreshCwIcon,
  BanIcon,
  LinkIcon,
} from "lucide-react";
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
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-6 py-8 md:px-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
        <Link
          href="/research-studio"
          className="font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Research Studio
        </Link>
        <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-semibold text-foreground">{course.code}</span>
      </nav>

      <Card className="overflow-hidden">
        <div
          aria-hidden="true"
          className="h-2 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/50"
        />
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
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
        <div className="space-y-5">
          <section id="materials" className="scroll-mt-6">
            <Card className="overflow-hidden">
              <CardContent className="p-4 md:p-5">
                <CourseMaterialsPanel courseId={course.id} isTeacher={isTeacher} />
              </CardContent>
            </Card>
          </section>

          <section id="starters" className="scroll-mt-6">
            <Card className="overflow-hidden">
              <CardContent className="p-4 md:p-5">
                <CourseStarterProjectsPanel courseId={course.id} isTeacher={isTeacher} />
              </CardContent>
            </Card>
          </section>

          {course.code === "CSC111" ? (
            <section id="groups" className="scroll-mt-6">
              <Card className="overflow-hidden">
                <CardContent className="p-4 md:p-5">
                  <CourseGroupsPanel courseId={course.id} courseCode={course.code} />
                </CardContent>
              </Card>
            </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-input px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BookOpenIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                Course
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <nav className="flex flex-col gap-1">
                <a
                  href="#materials"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <FileTextIcon className="size-4" aria-hidden="true" />
                  Materials
                </a>
                <a
                  href="#starters"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <FolderOpenIcon className="size-4" aria-hidden="true" />
                  Starter projects
                </a>
                {course.code === "CSC111" ? (
                  <a
                    href="#groups"
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <UsersIcon className="size-4" aria-hidden="true" />
                    Practical groups
                  </a>
                ) : null}
              </nav>
            </CardContent>
          </Card>

          {isTeacher ? (
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-input px-4 py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <SettingsIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  Administration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-3">
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
                        {revealed ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
                        {revealed ? "Hide link" : "Reveal link"}
                      </Button>
                      {revealed ? <code className="text-xs font-semibold">{joinCode}</code> : null}
                      {revealed ? (
                        <Button variant="warning" size="sm" onClick={copyLink}>
                          <CopyIcon aria-hidden="true" />
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
                          <div className="flex flex-col gap-2">
                            <Button variant="outline" size="sm" onClick={regenerateLink}>
                              <RefreshCwIcon aria-hidden="true" />
                              Regenerate link
                            </Button>
                            <Button variant="outline" size="sm" onClick={disableLink}>
                              <BanIcon aria-hidden="true" />
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
                      <LinkIcon aria-hidden="true" />
                      Generate link
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import { showToast } from "@/app/components/toast";

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

export default function CoursePanel() {
  const { isLoaded, isSignedIn } = useAuth();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinChoiceOpen, setJoinChoiceOpen] = useState(false);

  const [formCode, setFormCode] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formInstitution, setFormInstitution] = useState("");
  const [formError, setFormError] = useState("");
  const [formBusy, setFormBusy] = useState(false);

  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);

  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editInstitution, setEditInstitution] = useState("");
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const cRes = await fetch("/api/courses", { cache: "no-store" });
      if (cRes.ok) {
        const json = await cRes.json();
        setCourses(Array.isArray(json.courses) ? json.courses : []);
        setCanCreate(Boolean(json.canCreate));
        setError("");
      } else {
        setError("Could not load your courses.");
        return;
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

  function openEdit(course: Course) {
    setEditingCourse(course);
    setEditCode(course.code);
    setEditTitle(course.title);
    setEditInstitution(course.institution);
    setEditError("");
  }

  async function updateCourse() {
    if (!editingCourse) return;
    const code = editCode.trim();
    const title = editTitle.trim();
    if (!code || !title) {
      setEditError("Course code and title are required.");
      return;
    }
    setEditBusy(true);
    setEditError("");
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          courseId: editingCourse.id,
          code,
          title,
          institution: editInstitution.trim(),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setEditError(json?.error || "Could not update the course.");
        return;
      }
      setEditingCourse(null);
      showToast("Course updated", "success");
      await load();
    } catch {
      setEditError("Could not update the course.");
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteCourse(course: Course) {
    if (
      !window.confirm(
        `Delete "${course.title}"? This permanently removes the course, its join link, enrollments, and group-staff assignments.`
      )
    )
      return;
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", courseId: course.id, confirm: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(json?.error || "Could not delete the course.", "error");
        return;
      }
      showToast("Course deleted", "success");
      await load();
    } catch {
      showToast("Could not delete the course.", "error");
    }
  }

  if (!isLoaded) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Loading courses…</p>
      </Card>
    );
  }

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {canCreate ? (
        <Button onClick={() => { setFormError(""); setCreateOpen(true); }}>
          Create course
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => { setJoinError(""); setJoinChoiceOpen(true); }}>
        Join with a course
      </Button>
    </div>
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-input px-4 py-3">
        <div>
          <CardTitle>My Courses</CardTitle>
          <CardDescription className="mt-1 text-xs">
            {courses === null ? "" : `${courses.length} course${courses.length === 1 ? "" : "s"}${canCreate ? " · teaching" : ""}`}
          </CardDescription>
        </div>
        {isSignedIn ? headerActions : null}
      </CardHeader>

      <CardContent className="p-3">
        {!isSignedIn ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Sign in to see your courses.</p>
        ) : error ? (
          <p className="px-1 py-2 text-xs font-semibold text-destructive">{error}</p>
        ) : courses === null ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Loading courses…</p>
        ) : courses && courses.length === 0 ? (
          <div className="flex flex-col items-center px-3 py-5 text-center">
            <p className="text-sm font-semibold">No courses yet</p>
            <p className="mt-1 mb-3 text-xs text-muted-foreground">
              {canCreate ? "Create a course and share its join link, or join one with a code." : "Join a course with the link or code your teacher shared."}
            </p>
            {headerActions}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {(courses || []).map((course) => {
              return (
                <Card key={course.id} className="justify-between gap-3">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate">{course.title}</CardTitle>
                        <CardDescription className="mt-1 truncate text-xs">
                          {course.code}{course.institution ? ` · ${course.institution}` : ""}
                        </CardDescription>
                      </div>
                      <Badge variant={course.is_teacher ? "secondary" : "outline"} className="shrink-0">
                        {course.is_teacher ? "Teaching" : "Enrolled"}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      {course.member_count} member{course.member_count === 1 ? "" : "s"}
                      {course.my_role === "lecturer" ? " · lecturer" : course.my_role === "assistant" ? " · assistant" : ""}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 border-t border-input pt-3">
                      <Link
                        href={`/course/${course.id}`}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                      >
                        Open course
                      </Link>
                      {course.is_teacher ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(course)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => deleteCourse(course)}
                          >
                            Delete
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Join choice dialog */}
      <Dialog open={joinChoiceOpen} onOpenChange={setJoinChoiceOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Join with a course</DialogTitle>
            <DialogDescription>Choose how you want to continue.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <button
              type="button"
              className="flex w-full flex-col items-start gap-1 rounded-lg border border-input bg-card p-3 text-left text-sm font-medium transition-colors hover:bg-muted"
              onClick={() => { setJoinChoiceOpen(false); setJoinError(""); setJoinOpen(true); }}
            >
              <span className="text-sm font-semibold">Join as a student</span>
              <span className="text-xs font-normal text-muted-foreground">Enter a join code from your teacher. You can join multiple courses.</span>
            </button>
            {canCreate ? (
              <button
                type="button"
                className="flex w-full flex-col items-start gap-1 rounded-lg border border-input bg-card p-3 text-left text-sm font-medium transition-colors hover:bg-muted"
                onClick={() => { setJoinChoiceOpen(false); setFormError(""); setCreateOpen(true); }}
              >
                <span className="text-sm font-semibold">I am a teacher</span>
                <span className="text-xs font-normal text-muted-foreground">Create a course and generate its join link to share with students.</span>
              </button>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJoinChoiceOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {formError ? <p className="text-xs font-semibold text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createCourse} disabled={formBusy}>{formBusy ? "Creating…" : "Create course"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit course dialog */}
      <Dialog open={editingCourse !== null} onOpenChange={(open) => { if (!open) { setEditingCourse(null); setEditError(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit course</DialogTitle>
            <DialogDescription>Update the code, title, and institution for this course.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-course-code">Course code</Label>
              <Input id="edit-course-code" value={editCode} onChange={(e) => { setEditCode(e.target.value); setEditError(""); }} placeholder="e.g. CSC111" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-course-title">Course title</Label>
              <Input id="edit-course-title" value={editTitle} onChange={(e) => { setEditTitle(e.target.value); setEditError(""); }} placeholder="e.g. Introduction to Computer Science" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-course-institution">Institution (optional)</Label>
              <Input id="edit-course-institution" value={editInstitution} onChange={(e) => setEditInstitution(e.target.value)} placeholder="e.g. UNESWA" />
            </div>
            {editError ? <p className="text-xs font-semibold text-destructive">{editError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingCourse(null); setEditError(""); }}>Cancel</Button>
            <Button onClick={updateCourse} disabled={editBusy}>{editBusy ? "Saving…" : "Save changes"}</Button>
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
            {joinError ? <p className="text-xs font-semibold text-destructive">{joinError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJoinOpen(false)}>Cancel</Button>
            <Button onClick={joinCourse} disabled={joinBusy}>{joinBusy ? "Joining…" : "Join course"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

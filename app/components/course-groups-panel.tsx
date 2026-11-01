"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
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
import { CLASS_ASSESS_GROUP, VALID_PROGRAMMES } from "@/lib/groups";

type GroupItem = {
  id: string;
  name: string;
  schedule: string;
  capacity: number;
  sessionCount: number;
  testCount: number;
  examCount: number;
  members: number;
  joined: boolean;
  courseId: number | null;
  canAssess: boolean;
};

type AssessData = {
  students: {
    userId: string;
    name: string;
    surname: string;
    studentId: string;
    programme: string;
    group?: string;
    groupId?: string;
  }[];
  practicals: { id: number; title: string; maxMarks: number }[];
  tests: { id: number; title: string; maxMarks: number }[];
  exams: { id: number; title: string; maxMarks: number }[];
  marks: { itemId: number; studentId: string; score: number | null }[];
};

type StaffMember = { userId: string; role: string; email: string };

export default function CourseGroupsPanel({ courseId, courseCode }: { courseId: number; courseCode: string }) {
  const { isSignedIn } = useAuth();
  const { user: clerkUser } = useUser();

  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCourseTeacher, setIsCourseTeacher] = useState(false);
  const [buttons, setButtons] = useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // join dialog
  const [joinGroupId, setJoinGroupId] = useState<string | null>(null);
  const [joinName, setJoinName] = useState("");
  const [joinSurname, setJoinSurname] = useState("");
  const [joinProgramme, setJoinProgramme] = useState("");
  const [joinStudentId, setJoinStudentId] = useState("");
  const [joinError, setJoinError] = useState("");

  // switch dialog
  const [switchFromGroupId, setSwitchFromGroupId] = useState<string | null>(null);
  const [switchBusy, setSwitchBusy] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState("");

  // scores dialog
  const [scoresGroupId, setScoresGroupId] = useState<string | null>(null);
  const [scoresData, setScoresData] = useState<{
    practicals: { id: number; title: string; maxMarks: number; score: number | null }[];
    tests: { id: number; title: string; maxMarks: number; score: number | null }[];
  } | null>(null);
  const [scoresNotice, setScoresNotice] = useState("");

  // assess dialog
  const [assessGroupId, setAssessGroupId] = useState<string | null>(null);
  const [assessData, setAssessData] = useState<AssessData | null>(null);
  const [assessNotice, setAssessNotice] = useState("");
  const [assessSearch, setAssessSearch] = useState("");
  const [assessType, setAssessType] = useState<"all" | "practicals" | "tests" | "exams">("all");
  const assessSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // create / edit group (shared fields)
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSchedule, setEditSchedule] = useState("");
  const [editCapacity, setEditCapacity] = useState("50");
  const [editSessionCount, setEditSessionCount] = useState("4");
  const [editTestCount, setEditTestCount] = useState("1");
  const [editExamCount, setEditExamCount] = useState("1");
  const [editError, setEditError] = useState("");

  // edit / delete student
  const [editStudent, setEditStudent] = useState<{ groupId: string; userId: string } | null>(null);
  const [editStudentName, setEditStudentName] = useState("");
  const [editStudentSurname, setEditStudentSurname] = useState("");
  const [editStudentId, setEditStudentId] = useState("");
  const [editStudentProgramme, setEditStudentProgramme] = useState("");
  const [editStudentError, setEditStudentError] = useState("");
  const [editStudentBusy, setEditStudentBusy] = useState(false);
  const [deleteStudent, setDeleteStudent] = useState<{ groupId: string; userId: string; name: string; surname: string; studentId: string } | null>(null);
  const [deleteStudentBusy, setDeleteStudentBusy] = useState(false);
  const [deleteStudentError, setDeleteStudentError] = useState("");

  // staff assignment dialog
  const [staffGroupId, setStaffGroupId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffRole, setStaffRole] = useState<"assistant" | "teacher">("assistant");
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffError, setStaffError] = useState("");

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const [gRes, bRes] = await Promise.all([
        fetch(`/api/groups?courseId=${courseId}`, { cache: "no-store" }),
        fetch("/api/studio-buttons", { cache: "no-store" }),
      ]);
      const gData = (await gRes.json().catch(() => null)) as {
        groups?: GroupItem[];
        isAdmin?: boolean;
        isAssistant?: boolean;
        isCourseTeacher?: boolean;
      } | null;
      if (!gRes.ok || !gData?.groups) {
        setError("Couldn't load the groups. Please try again.");
        return;
      }
      setGroups(gData.groups);
      setIsAdmin(Boolean(gData.isAdmin));
      setIsCourseTeacher(Boolean(gData.isCourseTeacher));
      setError("");
      if (bRes.ok) {
        const bData = (await bRes.json().catch(() => null)) as { buttons?: Record<string, boolean> } | null;
        if (bData?.buttons) setButtons(bData.buttons);
      }
    } catch {
      setError("Couldn't load the groups. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    if (open) {
      // Fetch-on-open is intentional; results land in async callbacks.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadGroups();
    }
  }, [open, loadGroups]);

  function openJoinGroup(g: GroupItem) {
    setJoinGroupId(g.id);
    setJoinName(clerkUser?.firstName || "");
    setJoinSurname(clerkUser?.lastName || "");
    setJoinProgramme("");
    setJoinStudentId("");
    setJoinError("");
  }

  async function submitJoinGroup() {
    const groupId = joinGroupId;
    if (!groupId) return;
    const name = joinName.trim();
    const surname = joinSurname.trim();
    if (!name || !surname) return setJoinError("Name and surname are required.");
    if (!joinProgramme) return setJoinError("Choose a programme.");
    if (!/^\d{6}$|^\d{9}$/.test(joinStudentId.trim())) return setJoinError("Student ID must be 6 or 9 digits.");
    setJoinError("");
    setBusy(groupId);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", groupId, courseId, name, surname, programme: joinProgramme, studentId: joinStudentId.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setJoinError(data?.error || "Could not join the group.");
      else {
        showToast("Joined the group.", "success");
        setJoinGroupId(null);
      }
      await loadGroups();
    } catch {
      setJoinError("Could not join the group.");
    } finally {
      setBusy(null);
    }
  }

  function openSwitchGroup(groupId: string) {
    setSwitchFromGroupId(groupId);
    setSwitchError("");
  }

  async function submitSwitchGroup(toGroupId: string) {
    if (!switchFromGroupId) return;
    setSwitchBusy(toGroupId);
    setSwitchError("");
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", groupId: switchFromGroupId, toGroupId, courseId }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setSwitchError(data?.error || "Could not switch groups.");
      else {
        setSwitchFromGroupId(null);
        showToast("Switched group — your marks moved with you.", "success");
        await loadGroups();
      }
    } catch {
      setSwitchError("Could not switch groups.");
    } finally {
      setSwitchBusy(null);
    }
  }

  async function openScores(groupId: string) {
    setScoresGroupId(groupId);
    setScoresData(null);
    setScoresNotice("");
    try {
      const res = await fetch(`/api/groups/scores?group=${encodeURIComponent(groupId)}`);
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Couldn't load your scores.");
      }
      setScoresData(await res.json());
    } catch (e) {
      setScoresNotice(e instanceof Error ? e.message : "Couldn't load your scores.");
    }
  }

  async function openAssess(groupId: string) {
    setAssessGroupId(groupId);
    setAssessData(null);
    setAssessNotice("");
    setAssessType("all");
    try {
      const qs = groupId === CLASS_ASSESS_GROUP
        ? `/api/groups/assess?group=${encodeURIComponent(groupId)}&courseId=${courseId}`
        : `/api/groups/assess?group=${encodeURIComponent(groupId)}`;
      const res = await fetch(qs);
      if (!res.ok) throw new Error();
      setAssessData((await res.json()) as AssessData);
    } catch {
      setAssessNotice("Couldn't load the assessment sheet.");
    }
  }

  async function saveSingleMark(itemId: number, studentId: string, score: number | null) {
    if (!assessGroupId) return;
    try {
      const res = await fetch("/api/groups/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: assessGroupId,
          courseId: assessGroupId === CLASS_ASSESS_GROUP ? courseId : undefined,
          marks: [{ itemId, studentId, score }],
        }),
      });
      if (res.ok) showToast("Mark saved", "success");
      else showToast("Couldn't save the mark", "error");
    } catch {
      showToast("Couldn't save the mark", "error");
    }
  }

  function setMark(itemId: number, studentId: string, value: string) {
    const score = value.trim() === "" ? null : Number(value);
    setAssessData((cur) =>
      cur
        ? {
            ...cur,
            marks: [
              ...cur.marks.filter((m) => !(m.itemId === itemId && m.studentId === studentId)),
              { itemId, studentId, score },
            ],
          }
        : cur
    );
    if (assessSaveTimerRef.current) clearTimeout(assessSaveTimerRef.current);
    assessSaveTimerRef.current = setTimeout(() => {
      void saveSingleMark(itemId, studentId, score);
    }, 700);
  }

  function blurMark(itemId: number, studentId: string, value: string) {
    if (assessSaveTimerRef.current) clearTimeout(assessSaveTimerRef.current);
    const score = value.trim() === "" ? null : Number(value);
    void saveSingleMark(itemId, studentId, score);
  }

  async function reloadAssessData() {
    if (!assessGroupId) return;
    try {
      const res = await fetch(`/api/groups/assess?group=${encodeURIComponent(assessGroupId)}`);
      if (res.ok) setAssessData((await res.json()) as AssessData);
    } catch {
      // Keep the current sheet if the refresh fails.
    }
  }

  function openEditStudent(st: AssessData["students"][number]) {
    if (!assessGroupId || assessGroupId === CLASS_ASSESS_GROUP) return;
    setEditStudent({ groupId: assessGroupId, userId: st.userId });
    setEditStudentName(st.name);
    setEditStudentSurname(st.surname);
    setEditStudentId(st.studentId);
    setEditStudentProgramme(st.programme);
    setEditStudentError("");
  }

  async function submitEditStudent() {
    const target = editStudent;
    if (!target) return;
    const name = editStudentName.trim();
    const surname = editStudentSurname.trim();
    if (!name || !surname) return setEditStudentError("Name and surname are required.");
    if (!/^\d{6}$|^\d{9}$/.test(editStudentId.trim())) return setEditStudentError("Student ID must be 6 or 9 digits.");
    if (!editStudentProgramme) return setEditStudentError("Choose a programme.");
    setEditStudentError("");
    setEditStudentBusy(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-member",
          groupId: target.groupId,
          memberUserId: target.userId,
          name,
          surname,
          programme: editStudentProgramme,
          studentId: editStudentId.trim(),
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setEditStudentError(data?.error || "Could not update the student.");
      else {
        setEditStudent(null);
        await reloadAssessData();
      }
    } catch {
      setEditStudentError("Could not update the student.");
    } finally {
      setEditStudentBusy(false);
    }
  }

  function openDeleteStudent(st: AssessData["students"][number]) {
    if (!assessGroupId || assessGroupId === CLASS_ASSESS_GROUP) return;
    setDeleteStudent({ groupId: assessGroupId, userId: st.userId, name: st.name, surname: st.surname, studentId: st.studentId });
    setDeleteStudentError("");
  }

  async function submitDeleteStudent() {
    const target = deleteStudent;
    if (!target) return;
    setDeleteStudentError("");
    setDeleteStudentBusy(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-member", groupId: target.groupId, memberUserId: target.userId }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setDeleteStudentError(data?.error || "Could not delete the student.");
      else {
        setDeleteStudent(null);
        await reloadAssessData();
      }
    } catch {
      setDeleteStudentError("Could not delete the student.");
    } finally {
      setDeleteStudentBusy(false);
    }
  }

  function openEditGroup(g: GroupItem) {
    setEditGroupId(g.id);
    setEditName(g.name);
    setEditSchedule(g.schedule);
    setEditCapacity(String(g.capacity));
    setEditSessionCount(String(g.sessionCount));
    setEditTestCount(String(g.testCount));
    setEditExamCount(String(g.examCount));
    setEditError("");
  }

  async function submitEditGroup() {
    const groupId = editGroupId;
    if (!groupId) return;
    if (!editName.trim()) return setEditError("Name is required.");
    setEditError("");
    setBusy(groupId);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          groupId,
          courseId,
          name: editName,
          schedule: editSchedule,
          capacity: Number(editCapacity) || 50,
          sessionCount: Number(editSessionCount) || 4,
          testCount: Number(editTestCount) || 1,
          examCount: Number(editExamCount) || 1,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setEditError(data?.error || "Could not update the group.");
      } else {
        setEditGroupId(null);
      }
      await loadGroups();
    } catch {
      setEditError("Could not update the group.");
    } finally {
      setBusy(null);
    }
  }

  function openCreateGroup() {
    setEditName("");
    setEditSchedule("");
    setEditCapacity("50");
    setEditSessionCount("4");
    setEditTestCount("1");
    setEditExamCount("1");
    setEditError("");
    setCreateOpen(true);
  }

  async function submitCreateGroup() {
    if (!editName.trim()) return setEditError("Name is required.");
    setEditError("");
    setBusy("__create__");
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          courseId,
          name: editName,
          schedule: editSchedule,
          capacity: Number(editCapacity) || 50,
          sessionCount: Number(editSessionCount) || 4,
          testCount: Number(editTestCount) || 1,
          examCount: Number(editExamCount) || 1,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setEditError(data?.error || "Could not create the group.");
      } else {
        setCreateOpen(false);
        await loadGroups();
      }
    } catch {
      setEditError("Could not create the group.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteGroup(groupId: string) {
    const group = groups.find((g) => g.id === groupId);
    if (!window.confirm(`Delete ${group?.name || "group"}? This removes the group, its members, and its assessment marks. This cannot be undone.`)) return;
    setBusy(groupId);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", groupId, courseId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        showToast(data?.error || "Could not delete the group.", "error");
      } else {
        await loadGroups();
      }
    } catch {
      showToast("Could not delete the group.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function openStaff(groupId: string) {
    setStaffGroupId(groupId);
    setStaff([]);
    setStaffEmail("");
    setStaffRole("assistant");
    setStaffError("");
    setStaffLoading(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-staff", groupId }),
      });
      const data = (await res.json().catch(() => null)) as { staff?: StaffMember[]; error?: string } | null;
      if (!res.ok || !data?.staff) setStaffError(data?.error || "Could not load staff.");
      else setStaff(data.staff);
    } catch {
      setStaffError("Could not load staff.");
    } finally {
      setStaffLoading(false);
    }
  }

  async function submitAssignStaff() {
    const groupId = staffGroupId;
    if (!groupId) return;
    const email = staffEmail.trim();
    if (!email) return setStaffError("Enter a staff member's email.");
    setStaffBusy(true);
    setStaffError("");
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign-staff", groupId, email, role: staffRole }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setStaffError(data?.error || "Could not assign staff.");
      else {
        setStaffEmail("");
        await openStaff(groupId);
      }
    } catch {
      setStaffError("Could not assign staff.");
    } finally {
      setStaffBusy(false);
    }
  }

  async function removeStaff(groupId: string, userId: string) {
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unassign-staff", groupId, memberUserId: userId }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) showToast(data?.error || "Could not remove staff.", "error");
      else await openStaff(groupId);
    } catch {
      showToast("Could not remove staff.", "error");
    }
  }

  const canAssessClass = buttons ? Boolean(buttons.assessClass) : isAdmin;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="studio-btn studio-btn-secondary"
        style={{ height: "auto", padding: "4px 10px", fontSize: 11 }}
        title={`Practical groups for ${courseCode}`}
      >
        Practical groups
      </button>

      {open ? (
        <Dialog open onOpenChange={(next) => { if (!next) setOpen(false); }}>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto overscroll-contain">
            <DialogHeader>
              <DialogTitle>Practical groups — {courseCode}</DialogTitle>
              <DialogDescription>
                Join a practical group — up to 50 students per group.
              </DialogDescription>
            </DialogHeader>

            {isSignedIn && (isAdmin || canAssessClass) ? (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                {canAssessClass ? (
                  <button
                    type="button"
                    onClick={() => void openAssess(CLASS_ASSESS_GROUP)}
                    className="studio-btn"
                    style={{ background: "linear-gradient(135deg,#9333ea,#d946ef)", color: "#fff", border: "none", fontWeight: 700, height: 30, fontSize: 11, padding: "0 10px" }}
                    title="Assess all students across every group in this course"
                  >
                    Assess whole class
                  </button>
                ) : null}
                {isCourseTeacher ? (
                  <button type="button" onClick={openCreateGroup} className="studio-btn studio-btn-primary" style={{ height: 30, fontSize: 11, padding: "0 10px" }}>
                    <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 4v12M4 10h12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    New group
                  </button>
                ) : null}
                {isAdmin ? (
                  <>
                    <a href={`/api/groups/pdf?group=all&courseId=${courseId}`} download className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 11, padding: "0 10px", textDecoration: "none" }} title="Download all students with marks (PDF)">
                      All students (PDF)
                    </a>
                    <a href={`/api/groups/excel?group=all&courseId=${courseId}`} download className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 11, padding: "0 10px", textDecoration: "none" }} title="Download all students with marks (Excel)">
                      All students (Excel)
                    </a>
                  </>
                ) : null}
              </div>
            ) : null}

            {!isSignedIn ? (
              <div className="studio-groups-lock">
                <svg viewBox="0 0 20 20" style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="5" y="9" width="10" height="8" rx="1.5" />
                  <path d="M7 9V6a3 3 0 0 1 6 0v3" strokeLinecap="round" />
                </svg>
                <SignInButton mode="modal">
                  <button type="button" className="studio-groups-signin">Sign in to join a practical group.</button>
                </SignInButton>
              </div>
            ) : error ? (
              <div className="studio-groups-lock">
                <span>{error}</span>
                <button type="button" onClick={() => void loadGroups()} className="studio-btn studio-btn-secondary" style={{ height: 28, fontSize: 11, padding: "0 10px" }}>
                  Retry
                </button>
              </div>
            ) : loading ? (
              <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>Loading groups…</p>
            ) : (
              <div className="studio-groups-grid">
                {groups.map((g) => {
                  const full = g.members >= g.capacity;
                  const pct = Math.min(100, Math.round((g.members / g.capacity) * 100));
                  const pctColor = full ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#4ade80";
                  const inAnyGroup = groups.some((x) => x.joined);
                  return (
                    <article key={g.id} className="studio-group-card">
                      <div>
                        <p className="studio-group-name">{g.name}</p>
                        <p className="studio-group-schedule">{g.schedule}</p>
                      </div>
                      <div className="studio-group-capacity">
                        <div className="studio-group-bar"><div style={{ width: `${pct}%`, background: pctColor }} /></div>
                        <span className="studio-group-pct" style={{ color: pctColor }}>{pct}% full</span>
                        <span className="studio-group-count">{g.members}/{g.capacity}</span>
                      </div>
                      <div className="studio-group-actions">
                        {g.joined ? (
                          <button type="button" onClick={() => openSwitchGroup(g.id)} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 11, padding: "0 12px" }} title="Switch to another group">
                            Switch
                          </button>
                        ) : !inAnyGroup ? (
                          <button type="button" onClick={() => openJoinGroup(g)} disabled={full || busy === g.id} className="studio-btn studio-btn-primary" style={{ height: 30, fontSize: 11, padding: "0 12px" }}>
                            {full ? "Full" : busy === g.id ? "Joining…" : "Join group"}
                          </button>
                        ) : null}
                        {g.joined && (!buttons || buttons.scores) ? (
                          <button type="button" onClick={() => void openScores(g.id)} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 11, padding: "0 10px" }} title="View my practical and test scores">
                            My scores
                          </button>
                        ) : null}
                        {g.canAssess ? (
                          <button type="button" onClick={() => void openAssess(g.id)} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 11, padding: "0 10px" }} title="Assess students">
                            Assess
                          </button>
                        ) : null}
                        {isCourseTeacher ? (
                          <>
                            <button type="button" onClick={() => openStaff(g.id)} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 11, padding: "0 10px" }} title="Assign staff to teach/assess this group">
                              Staff
                            </button>
                            <button type="button" onClick={() => openEditGroup(g)} className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 11, padding: "0 10px" }} title="Edit group">
                              Edit
                            </button>
                          </>
                        ) : null}
                        {isAdmin ? (
                          <>
                            <a href={`/api/groups/pdf?group=${g.id}`} download className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 11, padding: "0 10px", textDecoration: "none" }} title="Download roster PDF (with marks)">
                              PDF
                            </a>
                            <a href={`/api/groups/excel?group=${g.id}`} download className="studio-btn studio-btn-ghost" style={{ height: 30, fontSize: 11, padding: "0 10px", textDecoration: "none" }} title="Download roster Excel (with marks)">
                              Excel
                            </a>
                            <button type="button" onClick={() => void handleDeleteGroup(g.id)} disabled={busy === g.id} className="studio-btn studio-btn-danger" style={{ height: 30, fontSize: 11, padding: "0 10px" }} title="Delete group">
                              {busy === g.id ? "…" : "Delete"}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Join dialog */}
      {joinGroupId ? (
        <Dialog open onOpenChange={(next) => { if (!next) setJoinGroupId(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Join {groups.find((g) => g.id === joinGroupId)?.name || "group"}</DialogTitle>
              <DialogDescription>Enter your name, surname, and programme to join this group.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="join-name">Name</Label>
                <Input id="join-name" value={joinName} onChange={(e) => setJoinName(e.target.value)} placeholder="Your first name" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="join-surname">Surname</Label>
                <Input id="join-surname" value={joinSurname} onChange={(e) => setJoinSurname(e.target.value)} placeholder="Your surname" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="join-student-id">Student ID</Label>
                <Input id="join-student-id" value={joinStudentId} onChange={(e) => setJoinStudentId(e.target.value)} placeholder="6 or 9 digits" inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="join-programme">Programme</Label>
                <select id="join-programme" value={joinProgramme} onChange={(e) => setJoinProgramme(e.target.value)} className="studio-sort-select" style={{ width: "100%" }}>
                  <option value="">Select programme</option>
                  {VALID_PROGRAMMES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              {joinError ? <p className="text-xs font-semibold text-[var(--danger)]">{joinError}</p> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setJoinGroupId(null)}>Cancel</Button>
              <Button onClick={() => void submitJoinGroup()} disabled={busy === joinGroupId}>
                {busy === joinGroupId ? "Joining…" : "Join group"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Switch dialog */}
      {switchFromGroupId ? (
        <Dialog open onOpenChange={(next) => { if (!next) setSwitchFromGroupId(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Switch group</DialogTitle>
              <DialogDescription>
                Moving from {groups.find((g) => g.id === switchFromGroupId)?.name || "this group"}.
                Your practical and test marks move with you.
              </DialogDescription>
            </DialogHeader>
            {switchError ? <p className="text-xs font-semibold text-[var(--danger)]">{switchError}</p> : null}
            {(() => {
              const options = groups.filter((g) => g.id !== switchFromGroupId && !g.joined && g.members < g.capacity);
              if (options.length === 0) {
                return <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>No other groups have space available right now.</p>;
              }
              return (
                <div className="space-y-2">
                  {options.map((g) => (
                    <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</p>
                        <p style={{ fontSize: 11, color: "var(--text-muted, #64748b)" }}>{g.schedule} · {g.members}/{g.capacity}</p>
                      </div>
                      <Button variant="outline" onClick={() => void submitSwitchGroup(g.id)} disabled={switchBusy === g.id}>
                        {switchBusy === g.id ? "Switching…" : "Switch"}
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })()}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSwitchFromGroupId(null)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Scores dialog */}
      {scoresGroupId ? (
        <Dialog open onOpenChange={(next) => { if (!next) setScoresGroupId(null); }}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>My scores — {groups.find((g) => g.id === scoresGroupId)?.name || "group"}</DialogTitle>
              <DialogDescription>Your practical and test marks. Examinations are released separately.</DialogDescription>
            </DialogHeader>
            {!scoresData ? (
              <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{scoresNotice || "Loading…"}</p>
            ) : (() => {
              const rows = [
                ...scoresData.practicals.map((s) => ({ ...s, kind: "Practical" as const })),
                ...scoresData.tests.map((s) => ({ ...s, kind: "Test" as const })),
              ];
              const total = rows.reduce((a, s) => a + (s.score ?? 0), 0);
              const maxTotal = rows.reduce((a, s) => a + s.maxMarks, 0);
              return (
                <div className="space-y-4">
                  <div className="studio-scores-scroll">
                    <table className="studio-scores-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th style={{ textAlign: "right" }}>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((s) => (
                          <tr key={`${s.kind}-${s.id}`}>
                            <td>{s.title}</td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                              {s.score == null ? "—" : `${s.score} / ${s.maxMarks}`}
                            </td>
                          </tr>
                        ))}
                        {rows.length === 0 ? (
                          <tr><td colSpan={2}>No practicals or tests for this group yet.</td></tr>
                        ) : null}
                      </tbody>
                      {rows.length > 0 ? (
                        <tfoot>
                          <tr>
                            <td style={{ fontWeight: 700 }}>Total</td>
                            <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                              {total} / {maxTotal}
                            </td>
                          </tr>
                        </tfoot>
                      ) : null}
                    </table>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setScoresGroupId(null)}>Close</Button>
                  </DialogFooter>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Assess dialog */}
      {assessGroupId ? (
        <Dialog open onOpenChange={(next) => { if (!next) setAssessGroupId(null); }}>
          <DialogContent className="sm:max-w-screen-2xl sm:h-[88vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>{assessGroupId === CLASS_ASSESS_GROUP ? "Assess whole class" : `Assess ${groups.find((g) => g.id === assessGroupId)?.name || "group"}`}</DialogTitle>
              <DialogDescription>Enter marks per practical, test, and examination.</DialogDescription>
            </DialogHeader>
            {!assessData ? (
              <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{assessNotice || "Loading…"}</p>
            ) : (() => {
              const columns =
                assessType === "practicals"
                  ? assessData.practicals
                  : assessType === "tests"
                    ? assessData.tests
                    : assessType === "exams"
                      ? assessData.exams
                      : [...assessData.practicals, ...assessData.tests, ...assessData.exams];
              const markMap = new Map(assessData.marks.map((m) => [`${m.itemId}:${m.studentId}`, m.score]));
              const q = assessSearch.trim().toLowerCase();
              const filtered = q
                ? assessData.students.filter((st) =>
                    `${st.name} ${st.surname} ${st.studentId} ${st.programme}`.toLowerCase().includes(q)
                  )
                : assessData.students;
              return (
                <>
                  <div className="studio-assess-toolbar">
                    <input
                      value={assessSearch}
                      onChange={(e) => setAssessSearch(e.target.value)}
                      placeholder="Search students..."
                      className="studio-assess-search"
                    />
                    <div className="studio-assess-types">
                      <Button type="button" variant={assessType === "all" ? "default" : "outline"} size="sm" onClick={() => setAssessType("all")}>All</Button>
                      <Button type="button" variant={assessType === "practicals" ? "default" : "outline"} size="sm" onClick={() => setAssessType("practicals")}>Practicals</Button>
                      <Button type="button" variant={assessType === "tests" ? "default" : "outline"} size="sm" onClick={() => setAssessType("tests")}>Tests</Button>
                      <Button type="button" variant={assessType === "exams" ? "default" : "outline"} size="sm" onClick={() => setAssessType("exams")}>Examinations</Button>
                    </div>
                  </div>
                  <div className="studio-assess-scroll">
                    <table className="studio-assess-table" style={columns.length < 4 ? { minWidth: 0, width: "auto" } : undefined}>
                      <thead>
                        <tr>
                          <th>Student</th>
                          {columns.map((s) => (
                            <th key={s.id} title={`Max ${s.maxMarks} marks`}>{s.title}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((st) => (
                          <tr key={st.userId}>
                            <td className="studio-assess-student">
                              <span>{st.name} {st.surname}</span>
                              <span className="studio-assess-sid">{st.group ? `${st.group} · ` : ""}{st.studentId}{st.programme ? ` · ${st.programme}` : ""}</span>
                              {isAdmin && assessGroupId !== CLASS_ASSESS_GROUP ? (
                                <span style={{ display: "inline-flex", gap: 4, marginTop: 4 }}>
                                  {(!buttons || buttons.editStudent) ? (
                                    <button
                                      type="button"
                                      onClick={() => openEditStudent(st)}
                                      className="studio-btn studio-btn-ghost"
                                      style={{ height: 22, fontSize: 10, padding: "0 8px" }}
                                      title="Edit student details"
                                    >
                                      Edit
                                    </button>
                                  ) : null}
                                  {(!buttons || buttons.deleteStudent) ? (
                                    <button
                                      type="button"
                                      onClick={() => openDeleteStudent(st)}
                                      className="studio-btn studio-btn-danger"
                                      style={{ height: 22, fontSize: 10, padding: "0 8px" }}
                                      title="Delete student"
                                    >
                                      Delete
                                    </button>
                                  ) : null}
                                </span>
                              ) : null}
                            </td>
                            {columns.map((s) => {
                              const val = markMap.get(`${s.id}:${st.studentId}`);
                              return (
                                <td key={s.id}>
                                  <input
                                    type="number"
                                    min={0}
                                    max={s.maxMarks}
                                    value={val == null ? "" : String(val)}
                                    // eslint-disable-next-line react-hooks/refs
                                    onChange={(e) => setMark(s.id, st.studentId, e.target.value)}
                                    // eslint-disable-next-line react-hooks/refs
                                    onBlur={(e) => blurMark(s.id, st.studentId, e.target.value)}
                                    className="studio-assess-input"
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {filtered.length === 0 ? (
                          <tr><td colSpan={columns.length + 1} className="studio-assess-student">No students match.</td></tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  <DialogFooter>
                    {assessNotice ? <span style={{ fontSize: 11, color: "var(--text-muted, #64748b)" }}>{assessNotice}</span> : null}
                    {assessGroupId !== CLASS_ASSESS_GROUP ? (
                      <a href={`/api/groups/assess/export?group=${assessGroupId}`} download className="studio-btn studio-btn-secondary" style={{ height: 30, fontSize: 11, padding: "0 10px", textDecoration: "none" }}>
                        Export Excel
                      </a>
                    ) : null}
                    <Button variant="outline" onClick={() => setAssessGroupId(null)}>Close</Button>
                  </DialogFooter>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Edit group dialog */}
      {editGroupId ? (
        <Dialog open onOpenChange={(next) => { if (!next) setEditGroupId(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit group</DialogTitle>
              <DialogDescription>Change the group name, schedule, or capacity.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Name</Label>
                <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-schedule">Schedule</Label>
                <Input id="edit-schedule" value={editSchedule} onChange={(e) => setEditSchedule(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-capacity">Capacity</Label>
                <Input id="edit-capacity" type="number" min={1} max={200} value={editCapacity} onChange={(e) => setEditCapacity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-sessions">Practicals</Label>
                <Input id="edit-sessions" type="number" min={0} max={50} value={editSessionCount} onChange={(e) => setEditSessionCount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-tests">Tests</Label>
                <Input id="edit-tests" type="number" min={0} max={20} value={editTestCount} onChange={(e) => setEditTestCount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-exams">Examinations</Label>
                <Input id="edit-exams" type="number" min={0} max={20} value={editExamCount} onChange={(e) => setEditExamCount(e.target.value)} />
              </div>
              {editError ? <p className="text-xs font-semibold text-[var(--danger)]">{editError}</p> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditGroupId(null)}>Cancel</Button>
              <Button onClick={() => void submitEditGroup()} disabled={busy === editGroupId}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Create group dialog */}
      {createOpen ? (
        <Dialog open onOpenChange={(next) => { if (!next) setCreateOpen(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New practical group</DialogTitle>
              <DialogDescription>Create a new group students can join.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-name">Name</Label>
                <Input id="create-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-schedule">Schedule</Label>
                <Input id="create-schedule" value={editSchedule} onChange={(e) => setEditSchedule(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-capacity">Capacity</Label>
                <Input id="create-capacity" type="number" min={1} max={200} value={editCapacity} onChange={(e) => setEditCapacity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-practicals">Practicals</Label>
                <Input id="create-practicals" type="number" min={0} max={50} value={editSessionCount} onChange={(e) => setEditSessionCount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-tests">Tests</Label>
                <Input id="create-tests" type="number" min={0} max={20} value={editTestCount} onChange={(e) => setEditTestCount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-exams">Examinations</Label>
                <Input id="create-exams" type="number" min={0} max={20} value={editExamCount} onChange={(e) => setEditExamCount(e.target.value)} />
              </div>
              {editError ? <p className="text-xs font-semibold text-[var(--danger)]">{editError}</p> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={() => void submitCreateGroup()} disabled={busy === "__create__"}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Edit student dialog */}
      {editStudent ? (
        <Dialog open onOpenChange={(next) => { if (!next) setEditStudent(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit student</DialogTitle>
              <DialogDescription>Update the name, student ID, and programme for this student.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-student-name">Name</Label>
                <Input id="edit-student-name" value={editStudentName} onChange={(e) => setEditStudentName(e.target.value)} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-student-surname">Surname</Label>
                <Input id="edit-student-surname" value={editStudentSurname} onChange={(e) => setEditStudentSurname(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-student-id">Student ID</Label>
                <Input id="edit-student-id" value={editStudentId} onChange={(e) => setEditStudentId(e.target.value)} placeholder="6 or 9 digits" inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-student-programme">Programme</Label>
                <select id="edit-student-programme" value={editStudentProgramme} onChange={(e) => setEditStudentProgramme(e.target.value)} className="studio-sort-select" style={{ width: "100%" }}>
                  <option value="">Select programme</option>
                  {VALID_PROGRAMMES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              {editStudentError ? <p className="text-xs font-semibold text-[var(--danger)]">{editStudentError}</p> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditStudent(null)}>Cancel</Button>
              <Button onClick={() => void submitEditStudent()} disabled={editStudentBusy}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Delete student dialog */}
      {deleteStudent ? (
        <Dialog open onOpenChange={(next) => { if (!next) setDeleteStudent(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete student</DialogTitle>
              <DialogDescription>
                Delete {deleteStudent.name} {deleteStudent.surname} ({deleteStudent.studentId}) from this group?
                This removes their marks and switch history for this group only — their account is not deleted.
              </DialogDescription>
            </DialogHeader>
            {deleteStudentError ? <p className="text-xs font-semibold text-[var(--danger)]">{deleteStudentError}</p> : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteStudent(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => void submitDeleteStudent()} disabled={deleteStudentBusy}>
                {deleteStudentBusy ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Staff assignment dialog */}
      {staffGroupId ? (
        <Dialog open onOpenChange={(next) => { if (!next) setStaffGroupId(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Group staff — {groups.find((g) => g.id === staffGroupId)?.name || "group"}</DialogTitle>
              <DialogDescription>Assign assistants or lecturers to teach and assess this group.</DialogDescription>
            </DialogHeader>
            {staffLoading ? (
              <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>Loading staff…</p>
            ) : (
              <div className="space-y-3">
                {staffError ? <p className="text-xs font-semibold text-[var(--danger)]">{staffError}</p> : null}
                {staff.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>No staff assigned yet.</p>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    {staff.map((s) => (
                      <li key={s.userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.email}
                          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "var(--text-muted, #64748b)" }}>{s.role}</span>
                        </span>
                        <Button variant="outline" size="sm" onClick={() => void removeStaff(staffGroupId, s.userId)}>Remove</Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="staff-email">Add staff by email</Label>
                  <Input id="staff-email" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} placeholder="name@example.com" autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="staff-role">Role</Label>
                  <select id="staff-role" value={staffRole} onChange={(e) => setStaffRole(e.target.value as "assistant" | "teacher")} className="studio-sort-select" style={{ width: "100%" }}>
                    <option value="assistant">Assistant</option>
                    <option value="teacher">Teacher</option>
                  </select>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStaffGroupId(null)}>Close</Button>
              <Button onClick={() => void submitAssignStaff()} disabled={staffBusy || staffLoading}>
                {staffBusy ? "Adding…" : "Add staff"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

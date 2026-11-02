import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { db, ensureMigrated } from "@/lib/db";
import { isCourseTeacher } from "@/lib/user-roles";
import CourseDashboard from "@/app/components/course-dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CoursePageProps = {
  params: Promise<{ courseId: string }>;
};

export default async function CoursePage({ params }: CoursePageProps) {
  const { courseId: rawId } = await params;
  const courseId = Number(rawId);
  if (!Number.isInteger(courseId) || courseId <= 0) notFound();

  const { userId } = await auth();
  if (!userId) redirect("/research-studio");
  await ensureMigrated();

  const courseResult = await db.query(
    `SELECT id, code, title, institution FROM wiserfiles_courses WHERE id = $1`,
    [courseId]
  );
  if (!courseResult.rows.length) notFound();
  const course = courseResult.rows[0] as {
    id: number;
    code: string;
    title: string;
    institution: string;
  };

  const isTeacher = await isCourseTeacher(userId, courseId);

  const memberResult = await db.query(
    `SELECT e.role
     FROM wiserfiles_enrollments e
     JOIN wiserfiles_cohorts c ON c.id = e.cohort_id
     WHERE c.course_id = $1 AND e.user_id = $2 AND e.status = 'active'
     ORDER BY e.joined_at DESC LIMIT 1`,
    [courseId, userId]
  );

  if (!isTeacher && !memberResult.rows.length) {
    redirect("/research-studio");
  }

  const cohortResult = await db.query(
    `SELECT id,
            join_code,
            (SELECT COUNT(*)::int FROM wiserfiles_enrollments e
              WHERE e.cohort_id = wiserfiles_cohorts.id AND e.status = 'active') AS member_count
     FROM wiserfiles_cohorts
     WHERE course_id = $1
     ORDER BY id LIMIT 1`,
    [courseId]
  );
  const cohortRow = cohortResult.rows[0] ?? null;

  return (
    <CourseDashboard
      course={course}
      memberCount={cohortRow ? Number(cohortRow.member_count) : 0}
      joinCode={isTeacher && cohortRow ? (cohortRow.join_code as string | null) : null}
      isTeacher={isTeacher}
      role={(memberResult.rows[0]?.role as string | null) ?? null}
    />
  );
}

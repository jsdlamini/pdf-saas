// Practical groups for the Research Studio. Group definitions come from the
// lecturer's sheet (six practical groups, 50-student cap). Students add
// themselves — memberships live in the database, not here.

export type StudyGroup = {
  id: string;
  name: string;
  schedule: string;
  capacity: number;
  sessionCount: number;
  testCount: number;
  examCount: number;
};

export const GROUP_CAPACITY = 50;
export const DEFAULT_SESSION_COUNT = 4;
export const DEFAULT_TEST_COUNT = 1;
export const DEFAULT_EXAM_COUNT = 1;

export const VALID_PROGRAMMES = [
  "BASS",
  "B.Sc",
  "BSc IS",
  "BSc IT",
  "B.Sc.Comp.Sci.Ed",
  "BSc.GISc",
  "Bsc. Act. Fin Math",
  "B.Eng(Electrical And Electronics)",
] as const;

export function isValidProgramme(value: string): boolean {
  return VALID_PROGRAMMES.some((p) => p.toLowerCase() === value.trim().toLowerCase());
}

export function isValidStudentId(value: string): boolean {
  return /^\d{6}$|^\d{9}$/.test(value.trim());
}

export const STUDY_GROUPS: StudyGroup[] = [
  { id: "group-a", name: "Group A", schedule: "Friday, 1 – 3 PM", capacity: GROUP_CAPACITY, sessionCount: DEFAULT_SESSION_COUNT, testCount: DEFAULT_TEST_COUNT, examCount: DEFAULT_EXAM_COUNT },
  { id: "group-b", name: "Group B", schedule: "Wednesday, 10:00 – 11:50 AM", capacity: GROUP_CAPACITY, sessionCount: DEFAULT_SESSION_COUNT, testCount: DEFAULT_TEST_COUNT, examCount: DEFAULT_EXAM_COUNT },
  { id: "group-c", name: "Group C", schedule: "Monday, 1 – 3 PM", capacity: GROUP_CAPACITY, sessionCount: DEFAULT_SESSION_COUNT, testCount: DEFAULT_TEST_COUNT, examCount: DEFAULT_EXAM_COUNT },
  { id: "group-d", name: "Group D", schedule: "Tuesday, 4 – 6 PM", capacity: GROUP_CAPACITY, sessionCount: DEFAULT_SESSION_COUNT, testCount: DEFAULT_TEST_COUNT, examCount: DEFAULT_EXAM_COUNT },
  { id: "group-e", name: "Group E", schedule: "Thursday, 4 – 6 PM", capacity: GROUP_CAPACITY, sessionCount: DEFAULT_SESSION_COUNT, testCount: DEFAULT_TEST_COUNT, examCount: DEFAULT_EXAM_COUNT },
  { id: "group-f", name: "Group F", schedule: "Wednesday, 2 – 4 PM", capacity: GROUP_CAPACITY, sessionCount: DEFAULT_SESSION_COUNT, testCount: DEFAULT_TEST_COUNT, examCount: DEFAULT_EXAM_COUNT },
];

export function getGroupById(id: string): StudyGroup | undefined {
  return STUDY_GROUPS.find((g) => g.id === id);
}

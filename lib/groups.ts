// Study groups for the Research Studio. Group definitions come from the
// lecturer's sheet (six tutorial groups, 50-student cap). Students add
// themselves — memberships live in the database, not here.

export type StudyGroup = {
  id: string;
  name: string;
  schedule: string;
  capacity: number;
};

export const GROUP_CAPACITY = 50;

export const STUDY_GROUPS: StudyGroup[] = [
  { id: "group-a", name: "Group A", schedule: "Friday, 1 – 3 PM", capacity: GROUP_CAPACITY },
  { id: "group-b", name: "Group B", schedule: "Wednesday, 10:00 – 11:50 AM", capacity: GROUP_CAPACITY },
  { id: "group-c", name: "Group C", schedule: "Monday, 1 – 3 PM", capacity: GROUP_CAPACITY },
  { id: "group-d", name: "Group D", schedule: "Tuesday, 4 – 6 PM", capacity: GROUP_CAPACITY },
  { id: "group-e", name: "Group E", schedule: "Thursday, 4 – 6 PM", capacity: GROUP_CAPACITY },
  { id: "group-f", name: "Group F", schedule: "Wednesday, 2 – 4 PM", capacity: GROUP_CAPACITY },
];

export function getGroupById(id: string): StudyGroup | undefined {
  return STUDY_GROUPS.find((g) => g.id === id);
}

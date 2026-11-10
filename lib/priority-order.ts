import type { Project, Task } from "./firebase-data";

function compareManualRank(a: { sortRank?: number }, b: { sortRank?: number }) {
  const aRanked = Number.isFinite(a.sortRank);
  const bRanked = Number.isFinite(b.sortRank);
  if (aRanked && bRanked) return (a.sortRank as number) - (b.sortRank as number);
  if (aRanked) return -1;
  if (bRanked) return 1;
  return 0;
}

export function orderedTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => compareManualRank(a, b)
    || (a.dueAt || "9999").localeCompare(b.dueAt || "9999")
    || b.createdAt.localeCompare(a.createdAt));
}

export function orderedProjects(projects: Project[]) {
  return [...projects].sort((a, b) => compareManualRank(a, b)
    || b.updatedAt.localeCompare(a.updatedAt));
}

export function moveBeforeOrAfter(ids: string[], sourceId: string, targetId: string) {
  const from = ids.indexOf(sourceId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return ids;
  const moved = ids.filter(id => id !== sourceId);
  const target = moved.indexOf(targetId);
  moved.splice(from < to ? target + 1 : target, 0, sourceId);
  return moved;
}

export function moveOne(ids: string[], id: string, direction: -1 | 1) {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const moved = [...ids];
  [moved[from], moved[to]] = [moved[to], moved[from]];
  return moved;
}

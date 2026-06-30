import type { RouteSnapshot } from "../types";

const SLOT_COUNT = 5;
const SLOT_CELL_WIDTH = 6;
const FILLED_SLOT = "■";
const EMPTY_SLOT = "□";

/**
 * 层数 ≤5：横向槽位 + L 形明细（栈顶在上）。
 * 层数 >5：后 4 槽仍为 L 形；仅首槽内多页用「├ / └」叠在 slot0，且明细行顺序与 ≤5 一致（先 tail 栈顶→下，再首槽折叠）。
 */
export function renderRouteStackGraph(history: RouteSnapshot[]): string {
  if (!history.length) return "";

  const lines: string[] = [];
  lines.push(renderSlotRow(history.length));
  lines.push(renderAxisRow(Math.min(history.length, SLOT_COUNT)));

  if (history.length <= SLOT_COUNT) lines.push(...renderDetailRowsShort(history));
  else lines.push(...renderDetailRowsOverflow(history));

  return lines.filter(Boolean).join("\n");
}

function renderSlotRow(historySize: number): string {
  const occupied = Math.min(historySize, SLOT_COUNT);
  const cells = Array.from({ length: SLOT_COUNT }, (_, index) => {
    const marker = index < occupied ? FILLED_SLOT : EMPTY_SLOT;
    return marker.padEnd(SLOT_CELL_WIDTH, " ");
  });
  return cells.join("").trimEnd();
}

function renderAxisRow(occupied: number): string {
  if (occupied <= 0) return "";

  const chars = Array.from({ length: SLOT_COUNT * SLOT_CELL_WIDTH }).fill(" ");
  for (let i = 0; i < occupied; i++) chars[getSlotCenter(i)] = "│";

  return chars.join("").trimEnd();
}

/** 层数 ≤5：与历史实现一致（栈顶在上） */
function renderDetailRowsShort(history: RouteSnapshot[]): string[] {
  return history
    .map((item, index) => ({ item, slot: index }))
    .reverse()
    .map(({ item, slot }) => renderBranch(slot, item.fullPath, "└"));
}

/** 层数 >5：先打后 4 槽（栈顶→下），再打首槽折叠（组内新→旧，├ / └） */
function renderDetailRowsOverflow(history: RouteSnapshot[]): string[] {
  const group = history.slice(0, history.length - (SLOT_COUNT - 1));
  const tail = history.slice(-(SLOT_COUNT - 1));
  const rows: string[] = [];

  tail
    .map((item, index) => ({ item, slot: index + 1 }))
    .reverse()
    .forEach(({ item, slot }) => {
      rows.push(renderBranch(slot, item.fullPath, "└"));
    });

  const reversedGroup = [...group].reverse();
  reversedGroup.forEach((item, i) => {
    const joint = i === reversedGroup.length - 1 ? "└" : "├";
    rows.push(renderBranch(0, item.fullPath, joint));
  });

  return rows;
}

function renderBranch(slot: number, label: string, joint: "└" | "├" | "│"): string {
  const prefixChars = Array.from({ length: SLOT_COUNT * SLOT_CELL_WIDTH }).fill(" ");
  for (let i = 0; i < slot; i++) prefixChars[getSlotCenter(i)] = "│";

  prefixChars[getSlotCenter(slot)] = joint;
  const prefix = prefixChars.join("").trimEnd();

  if (joint === "│") return `${prefix} …`;

  return `${prefix}─ ${label}`;
}

function getSlotCenter(slot: number): number {
  return slot * SLOT_CELL_WIDTH;
}

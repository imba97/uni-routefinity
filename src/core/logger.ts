import type { RouteSnapshot } from "../types";

const SLOT_COUNT = 5;
const SLOT_CELL_WIDTH = 6;

export function renderRouteStackGraph(history: RouteSnapshot[]): string {
  if (!history.length) return "";

  const lines: string[] = [];
  lines.push(renderSlotRow(history.length));
  lines.push(renderAxisRow(Math.min(history.length, SLOT_COUNT)));
  lines.push(...renderDetailRows(history));

  return lines.filter(Boolean).join("\n");
}

function renderSlotRow(historySize: number): string {
  const occupied = Math.min(historySize, SLOT_COUNT);
  let row = "";
  for (let index = 0; index < SLOT_COUNT; index++) {
    const marker = index < occupied ? "■" : "□";
    row += marker.padEnd(SLOT_CELL_WIDTH, " ");
  }
  return row.trimEnd();
}

function renderAxisRow(occupied: number): string {
  if (occupied <= 0) return "";

  const chars = Array.from({ length: SLOT_COUNT * SLOT_CELL_WIDTH }, () => " ");
  for (let i = 1; i < occupied; i++) {
    chars[getSlotCenter(i)] = "│";
  }
  return chars.join("").trimEnd();
}

function renderDetailRows(history: RouteSnapshot[]): string[] {
  if (history.length <= SLOT_COUNT) {
    const rows: string[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      rows.push(renderBranch(i, history[i].fullPath, "└"));
    }
    return rows;
  }

  const group = history.slice(0, history.length - (SLOT_COUNT - 1));
  const tail = history.slice(-(SLOT_COUNT - 1));
  const rows: string[] = [];

  for (let i = tail.length - 1; i >= 0; i--) {
    const slot = i + 1;
    rows.push(renderBranch(slot, tail[i].fullPath, "└"));
  }

  if (group.length > 1) {
    for (let i = group.length - 1; i >= 1; i--) {
      rows.push(renderBranch(0, group[i].fullPath, "├"));
    }
  }

  rows.push(renderBranch(0, group[0].fullPath, "└"));
  return rows;
}

function renderBranch(slot: number, label: string, joint: "└" | "├"): string {
  const prefixChars = Array.from({ length: SLOT_COUNT * SLOT_CELL_WIDTH }, () => " ");
  for (let i = 0; i < slot; i++) {
    prefixChars[getSlotCenter(i)] = "│";
  }
  prefixChars[getSlotCenter(slot)] = joint;
  const prefix = prefixChars.join("").trimEnd();
  return `${prefix}─ ${label}`;
}

function getSlotCenter(slot: number): number {
  return slot * SLOT_CELL_WIDTH;
}

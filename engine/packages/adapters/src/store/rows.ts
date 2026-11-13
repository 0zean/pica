import type { JsonValue } from "@pica/core";
import type { SQLOutputValue } from "node:sqlite";

export type Row = Record<string, SQLOutputValue>;

export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new TypeError(`column ${column} is not text`);
  }
  return value;
}

export function nullableText(row: Row, column: string): string | null {
  return row[column] === null ? null : text(row, column);
}

export function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`column ${column} is not an integer`);
  }
  return value;
}

export function real(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number") {
    throw new TypeError(`column ${column} is not a number`);
  }
  return value;
}

export function nullableReal(row: Row, column: string): number | null {
  return row[column] === null ? null : real(row, column);
}

// JSON columns only ever hold values this store serialized itself.
export function json(row: Row, column: string): JsonValue {
  const parsed: unknown = JSON.parse(text(row, column));
  return parsed as JsonValue;
}

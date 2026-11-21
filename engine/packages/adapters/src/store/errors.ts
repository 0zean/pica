import { err } from "@pica/core";
import type { StoreError, StoreErrorCode, StoreResult } from "@pica/core";
import { CorruptDatabaseError } from "./database.ts";

const sqliteBusy = 5;
const sqliteLocked = 6;
const sqliteCorrupt = 11;
const sqliteFull = 13;
const sqliteConstraint = 19;
const sqliteNotADatabase = 26;

export function storeError(code: StoreErrorCode, message: string): StoreError {
  return { code, message };
}

export function fail<T>(code: StoreErrorCode, message: string): StoreResult<T> {
  return err(storeError(code, message));
}

// Exceptions do not cross a port (PLAN.md §8): every repository method runs its body through this.
export function attempt<T>(body: () => StoreResult<T>): StoreResult<T> {
  try {
    return body();
  } catch (thrown) {
    return err(fromThrown(thrown));
  }
}

function fromThrown(thrown: unknown): StoreError {
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  if (thrown instanceof CorruptDatabaseError) {
    return storeError("store.corrupt", message);
  }
  const primaryCode = sqlitePrimaryCode(thrown);
  if (primaryCode === sqliteConstraint) {
    return storeError("store.conflict", message);
  }
  if (primaryCode === sqliteBusy || primaryCode === sqliteLocked) {
    return storeError("store.busy", message);
  }
  if (primaryCode === sqliteCorrupt || primaryCode === sqliteNotADatabase) {
    return storeError("store.corrupt", message);
  }
  if (primaryCode === sqliteFull) {
    return storeError("store.full", message);
  }
  return storeError("store.failed", message);
}

function sqlitePrimaryCode(thrown: unknown): number | undefined {
  if (typeof thrown !== "object" || thrown === null || !("errcode" in thrown)) {
    return undefined;
  }
  const { errcode } = thrown;
  // Extended result codes keep the primary code in the low byte.
  return typeof errcode === "number" ? errcode & 0xff : undefined;
}

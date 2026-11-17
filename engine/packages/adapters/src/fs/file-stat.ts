import { lstat } from "node:fs/promises";
import type { FileStat } from "@pica/core";

// What is at a path, without following a symlink (A-09 `files.*`).
export const fileStat: FileStat = async (absolutePath) => {
  try {
    const info = await lstat(absolutePath);
    const kind = info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file";
    return { kind, sizeBytes: info.size };
  } catch {
    return null;
  }
};

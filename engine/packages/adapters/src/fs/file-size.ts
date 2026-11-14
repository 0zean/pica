import { stat } from "node:fs/promises";

// Bytes in a regular file, or `undefined` when the path is missing, unreadable, or not a file.
export async function fileSize(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

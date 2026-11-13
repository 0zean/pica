import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { ConfigWatch } from "@pica/core";

// Calls `onEvent` whenever one of `files` may have changed; callers reload and compare.
//
// Each file is watched directly (kqueue on macOS). Its directory is watched too: that is the only
// way to see a missing file being created, or an editor's save that renames a new file over the
// old one, which ends the watch on the old file. A new watch takes effect on the next turn of the
// event loop, so one extra `onEvent` runs after that turn to catch a change made in between.
export function watchFiles(files: readonly string[], onEvent: () => void): ConfigWatch {
  const fileWatchers = new Map<string, FSWatcher>();
  let closed = false;

  const armFiles = (): void => {
    for (const file of files) {
      if (!fileWatchers.has(file)) {
        const watcher = tryWatch(file, (event) => {
          if (event === "rename") {
            watcher?.close();
            fileWatchers.delete(file);
          }
          handle();
        });
        if (watcher !== undefined) {
          fileWatchers.set(file, watcher);
        }
      }
    }
  };
  const handle = (): void => {
    if (!closed) {
      armFiles();
      onEvent();
    }
  };

  const directoryWatchers = [...namesByDirectory(files)].flatMap(([directory, names]) => {
    const watcher = tryWatch(directory, (_event, filename) => {
      if (filename === null || names.has(filename)) {
        handle();
      }
    });
    return watcher === undefined ? [] : [watcher];
  });
  armFiles();
  setImmediate(handle);

  return {
    close: () => {
      closed = true;
      for (const watcher of [...fileWatchers.values(), ...directoryWatchers]) {
        watcher.close();
      }
      fileWatchers.clear();
    },
  };
}

function namesByDirectory(files: readonly string[]): Map<string, Set<string>> {
  const directories = new Map<string, Set<string>>();
  for (const file of files) {
    const names = directories.get(dirname(file)) ?? new Set<string>();
    names.add(basename(file));
    directories.set(dirname(file), names);
  }
  return directories;
}

// A path that does not exist yet is not watched; the directory watch, or the next load, finds it.
function tryWatch(
  path: string,
  listener: (event: string, filename: string | null) => void,
): FSWatcher | undefined {
  try {
    const watcher = watch(path, listener);
    watcher.on("error", () => {
      watcher.close();
    });
    return watcher;
  } catch {
    return undefined;
  }
}

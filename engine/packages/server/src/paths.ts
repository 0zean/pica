import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_SOCKET_PATH = join(homedir(), "Library", "Application Support", "Pica", "run", "picad.sock");

// The script a client runs to start `picad` (the CLI does when no engine is listening).
export const ENGINE_ENTRY = join(import.meta.dirname, "main.ts");

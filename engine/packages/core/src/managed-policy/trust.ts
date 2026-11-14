export interface FileOwnership {
  readonly uid: number;
  readonly mode: number;
}

const rootUid = 0;
const groupOrOtherWrite = 0o022;

// A managed policy is only trusted when no one but root can have written it: the file and its
// directory must be owned by root and not writable by group or others.
export function ownershipProblem(path: string, ownership: FileOwnership): string | undefined {
  if (ownership.uid !== rootUid) {
    return `${path} is owned by uid ${String(ownership.uid)}, not root`;
  }
  if ((ownership.mode & groupOrOtherWrite) !== 0) {
    return `${path} is writable by users other than root`;
  }
  return undefined;
}

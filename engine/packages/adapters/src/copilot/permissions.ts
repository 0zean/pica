import type { PermissionHandler, PermissionRequestResult } from "@github/copilot-sdk";

type Answer = (approved: boolean) => void;

// Holds each runtime permission prompt until the host answers it with `resolvePermission`.
//
// The SDK calls the handler without the request id. It calls it synchronously while dispatching
// the `permission.requested` event, just before the session's event listeners see that event,
// so the answer queued by the handler belongs to the next event the listener registers.
export class PermissionDesk {
  private readonly awaitingId: Answer[] = [];
  private readonly pending = new Map<string, Answer>();

  readonly handler: PermissionHandler = () =>
    new Promise<PermissionRequestResult>((resolve) => {
      this.awaitingId.push((approved) => {
        resolve(approved ? { kind: "approve-once" } : { kind: "reject" });
      });
    });

  register(requestId: string): void {
    const answer = this.awaitingId.shift();
    if (answer !== undefined) {
      this.pending.set(requestId, answer);
    }
  }

  answer(requestId: string, approved: boolean): boolean {
    const answer = this.pending.get(requestId);
    if (answer === undefined) return false;
    this.pending.delete(requestId);
    answer(approved);
    return true;
  }

  declineAll(): void {
    for (const answer of [...this.awaitingId, ...this.pending.values()]) answer(false);
    this.awaitingId.length = 0;
    this.pending.clear();
  }
}

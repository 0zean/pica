import type { FanOutError, FanOutInfo, FanOutResult, FanOutService } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { ErrorCodeName } from "./errors.ts";
import type { MethodResult, MethodRouter } from "./router.ts";

const serviceCodes: Readonly<Record<FanOutError["code"], ErrorCodeName>> = {
  "fanout.not_found": "not_found",
  "fanout.invalid_request": "invalid_params",
};

function unwrap<T>(result: FanOutResult<T>): T {
  if (!result.ok) {
    throw new RpcFailure(serviceCodes[result.error.code], result.error.message, { reason: result.error.code });
  }
  return result.value;
}

export function toFanOutDto(fanOut: FanOutInfo): MethodResult<"fanout.get">["fanOut"] {
  return { ...fanOut, runs: fanOut.runs.map((run) => ({ ...run })) };
}

export function registerFanOutHandlers(router: MethodRouter, fanOuts: FanOutService): void {
  router.register("fanout.start", (params) => ({ fanOut: toFanOutDto(unwrap(fanOuts.start(params))) }));
  router.register("fanout.get", ({ fanOutId }) => ({ fanOut: toFanOutDto(unwrap(fanOuts.get(fanOutId))) }));
  router.register("fanout.list", ({ workspaceId }) => ({ fanOuts: fanOuts.list(workspaceId).map(toFanOutDto) }));
  router.register("fanout.cancel", async ({ fanOutId }) => ({ fanOut: toFanOutDto(unwrap(await fanOuts.cancel(fanOutId))) }));
}

import * as z from "zod";
import { Id } from "../common.ts";
import { Tier } from "./agents.ts";

const CreditsPerMillionTokens = z.number().nonnegative();

export const TokenPrices = z.object({
  input: CreditsPerMillionTokens,
  cachedInput: CreditsPerMillionTokens,
  output: CreditsPerMillionTokens,
});

export const ModelInfo = z.object({
  id: Id,
  name: z.string(),
  prices: TokenPrices.nullable(),
  allowedByPolicy: z.boolean(),
});

export const TierAssignment = z.object({
  tier: Tier,
  setting: z.string().min(1),
  resolvedModelId: Id.nullable(),
});

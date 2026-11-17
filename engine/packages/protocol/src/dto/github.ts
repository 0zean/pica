import * as z from "zod";

export const GitHubAuthStatus = z.object({
  host: z.string().min(1),
  signedIn: z.boolean(),
  provider: z.enum(["gh", "device_flow", "pat"]).nullable(),
  login: z.string().nullable(),
  scopes: z.array(z.string()),
});

export const GitHubTeam = z.object({
  org: z.string().min(1),
  slug: z.string().min(1),
  name: z.string(),
});

export const GitHubRepo = z.object({
  fullName: z.string().min(1),
  cloneUrl: z.string().min(1),
  archived: z.boolean(),
  fork: z.boolean(),
  topics: z.array(z.string()),
});

export const PullRequest = z.object({
  number: z.int().positive(),
  url: z.string().min(1),
  // The branches it merges from and into.
  head: z.string().min(1),
  base: z.string().min(1),
});

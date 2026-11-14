import { normalizeRemoteUrl } from "../repos/remote-url.ts";

export interface DiscoveredOrganization {
  readonly login: string;
}

export interface DiscoveredTeam {
  readonly org: string;
  readonly slug: string;
  readonly name: string;
}

export interface DiscoveredProperty {
  readonly name: string;
  readonly valueType: string;
  readonly allowedValues: readonly string[];
}

export interface DiscoveredRepo {
  // The normalized remote URL, which is a Repo's identity (PLAN.md §4.4).
  readonly remoteUrl: string;
  readonly fullName: string;
  readonly cloneUrl: string;
  readonly defaultBranch: string | null;
  readonly archived: boolean;
  readonly fork: boolean;
  readonly topics: readonly string[];
  // Single-select and string properties become one-element lists; unset properties are empty.
  readonly customProperties: Readonly<Record<string, readonly string[]>>;
}

type JsonRecord = Readonly<Record<string, unknown>>;

export function parseOrganization(value: unknown): DiscoveredOrganization | undefined {
  const login = stringField(asRecord(value), "login");
  return login === undefined ? undefined : { login };
}

// `GET /user/teams` embeds the team's organization.
export function parseTeam(value: unknown): DiscoveredTeam | undefined {
  const record = asRecord(value);
  const org = stringField(asRecord(record?.organization), "login");
  const slug = stringField(record, "slug");
  if (org === undefined || slug === undefined) {
    return undefined;
  }
  return { org, slug, name: stringField(record, "name") ?? slug };
}

export function parseProperty(value: unknown): DiscoveredProperty | undefined {
  const record = asRecord(value);
  const name = stringField(record, "property_name");
  if (name === undefined) {
    return undefined;
  }
  return {
    name,
    valueType: stringField(record, "value_type") ?? "string",
    allowedValues: stringList(record?.allowed_values),
  };
}

export function parseRepo(value: unknown): DiscoveredRepo | undefined {
  const record = asRecord(value);
  const fullName = stringField(record, "full_name");
  const cloneUrl = stringField(record, "clone_url");
  const identity = normalizeRemoteUrl(stringField(record, "html_url") ?? cloneUrl ?? "");
  if (fullName === undefined || cloneUrl === undefined || !identity.ok) {
    return undefined;
  }
  return {
    remoteUrl: identity.value.url,
    fullName,
    cloneUrl,
    defaultBranch: stringField(record, "default_branch") ?? null,
    archived: record?.archived === true,
    fork: record?.fork === true,
    topics: stringList(record?.topics),
    customProperties: propertyValues(record?.custom_properties),
  };
}

function propertyValues(value: unknown): Record<string, readonly string[]> {
  const record = asRecord(value);
  if (record === undefined) {
    return {};
  }
  const values: Record<string, readonly string[]> = {};
  for (const [name, raw] of Object.entries(record)) {
    values[name] = typeof raw === "string" ? [raw] : stringList(raw);
  }
  return values;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function stringField(record: JsonRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

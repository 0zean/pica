export type JsonRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function stringArrayField(record: JsonRecord, key: string): readonly string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return null;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

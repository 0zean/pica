export function normalizeHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name.toLowerCase()] = String(value).trim();
  }
  return result;
}

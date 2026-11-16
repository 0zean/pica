export function parseQuery(search) {
  const result = {};
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  for (const pair of trimmed.split("&")) {
    if (pair === "") continue;
    const [key, value = ""] = pair.split("=");
    result[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return result;
}

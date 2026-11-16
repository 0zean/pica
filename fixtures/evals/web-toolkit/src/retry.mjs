export function backoffDelays(attempts, baseMs, capMs) {
  const delays = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    delays.push(Math.min(capMs, baseMs * 2 ** attempt));
  }
  return delays;
}

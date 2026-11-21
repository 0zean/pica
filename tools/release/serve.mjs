// Serves a folder over HTTP on 127.0.0.1 for the update check; prints the port on its first stdout line.
// Usage: node tools/release/serve.mjs <folder>
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2]);
const server = createServer((request, response) => {
  const path = normalize(join(root, decodeURIComponent(new URL(request.url, "http://x").pathname)));
  let size;
  try {
    size = path.startsWith(root) ? statSync(path).size : undefined;
  } catch {
    size = undefined;
  }
  if (size === undefined) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-length": size, "content-type": "application/octet-stream" });
  createReadStream(path).pipe(response);
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));

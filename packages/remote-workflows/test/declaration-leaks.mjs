import { readFile } from "node:fs/promises";

const declaration = await readFile(
  new URL("../dist/bun/index.d.ts", import.meta.url),
  "utf8",
);

const forbiddenDeclarations = [
  [
    /\bBunWebSocketTransport\b/u,
    "The Bun declaration exposes capnweb's condition-specific BunWebSocketTransport.",
  ],
  [
    /\bRemoteWorkflowFactory\b/u,
    "The Bun declaration still exposes the workflow factory API.",
  ],
  [
    /types\/index/u,
    "The Bun declaration still references the removed structural workflow types.",
  ],
  [
    /cloudflare:workers/u,
    "The Bun declaration requires Cloudflare types instead of remaining structural.",
  ],
];

for (const [pattern, message] of forbiddenDeclarations) {
  if (pattern.test(declaration)) {
    throw new Error(message);
  }
}

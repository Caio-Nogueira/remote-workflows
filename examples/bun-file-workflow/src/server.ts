import { serveWorkflow } from "@cloudflare/remote-workflows/bun";
import { origin } from "./origin.ts";
import { WriteFileWorkflow } from "./workflow.ts";

serveWorkflow({
  ...origin,
  workflow: WriteFileWorkflow,
});

console.log(`Workflow origin listening at ws://127.0.0.1:${origin.port}${origin.path}`);


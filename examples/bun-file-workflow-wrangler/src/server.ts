import { serveWorkflow } from "@cloudflare/remote-workflows/bun";
import { WriteFileWorkflow } from "./workflow.ts";

serveWorkflow({
  path: "/write-file",
  port: 8789,
  workflow: WriteFileWorkflow,
});

console.log("Workflow origin listening at ws://127.0.0.1:8789/write-file");

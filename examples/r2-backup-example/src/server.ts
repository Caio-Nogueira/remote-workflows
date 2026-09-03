import { serveWorkflow } from "@cloudflare/remote-workflows/bun";
import { VaultwardenBackupWorkflow } from "./workflow.ts";

serveWorkflow({
  path: "/vaultwarden-backup",
  port: 8789,
  workflow: VaultwardenBackupWorkflow,
});

console.log(
  "Workflow origin listening at ws://127.0.0.1:8789/vaultwarden-backup",
);

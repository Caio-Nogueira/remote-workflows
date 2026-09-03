#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    help: { short: "h", type: "boolean" },
    stack: { type: "string" },
    stage: { type: "string" },
    "state-dir": { default: ".alchemy/state", type: "string" },
    workflow: { type: "string" },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage: remote-workflows-connect --stack <name> --workflow <id> [options]

Options:
  --stage <name>       Select an Alchemy stage
  --state-dir <path>   Set the Alchemy state directory
  -h, --help           Show this help`);
  process.exit(0);
}

assert(values.stack, "Missing required --stack");
assert(values.workflow, "Missing required --workflow");

const stackState = resolve(values["state-dir"], values.stack);
const stages = (await readdir(stackState, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const requestedStage = values.stage ?? process.env.ALCHEMY_STAGE;
const stage = requestedStage ?? (stages.length === 1 ? stages[0] : undefined);

assert(
  stage,
  `Found ${stages.length} deployed stages. Pass --stage with one of: ${stages.join(", ")}`,
);
assert(stages.includes(stage), `Alchemy stage not found: ${stage}`);

const state: unknown = JSON.parse(
  await readFile(
    resolve(stackState, stage, `${values.workflow}Tunnel.json`),
    "utf8",
  ),
);
assert(typeof state === "object" && state !== null, "Invalid tunnel state");

const { attr } = state as Record<string, unknown>;
assert(typeof attr === "object" && attr !== null, "Tunnel state has no output");

const { token: redactedToken, tunnelId } = attr as Record<string, unknown>;
assert(typeof tunnelId === "string", "Tunnel state has no tunnel ID");
assert(
  typeof redactedToken === "object" && redactedToken !== null,
  "Tunnel state has no connector token",
);

const token = (redactedToken as Record<string, unknown>).__redacted__;
assert(typeof token === "string" && token.length > 0, "Invalid connector token");

console.log(`Connecting tunnel ${tunnelId} from Alchemy stage ${stage}`);
const cloudflared = spawn(
  "cloudflared",
  ["tunnel", "run", "--token", token],
  { stdio: "inherit" },
);

process.once("SIGINT", () => cloudflared.kill("SIGINT"));
process.once("SIGTERM", () => cloudflared.kill("SIGTERM"));

process.exitCode = await new Promise<number>((resolveExit, reject) => {
  cloudflared.once("error", reject);
  cloudflared.once("exit", (code) => resolveExit(code ?? 1));
});

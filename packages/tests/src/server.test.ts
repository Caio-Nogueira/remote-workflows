import { describe, expect, it } from "vitest";
import * as z from "zod";
import { serveWorkflow } from "@cloudflare/remote-workflows/node";
import {
  REMOTE_WORKFLOW_PROTOCOL_HEADER,
  createWorkflowTarget,
  type RemoteWorkflowClass,
  validateUpgrade,
} from "@cloudflare/remote-workflows/server";

function request(headers: Record<string, string>) {
  return {
    headers: new Headers(headers),
    method: "GET",
  };
}

const event = {
  instanceId: "instance",
  payload: {},
  timestamp: new Date(),
  workflowName: "workflow",
};

const step = {
  do() {},
  sleep() {},
  sleepUntil() {},
  waitForEvent() {},
};

describe("upgrade validation", () => {
  it("accepts WebSocket upgrades with the current protocol", () => {
    const result = validateUpgrade(
      request({
        Upgrade: "websocket",
        "x-remote-workflow-protocol": "1",
      }),
    );

    expect(result).toEqual({ ok: true });
  });

  it("rejects protocol mismatches with the current version", () => {
    const result = validateUpgrade(
      request({
        Upgrade: "websocket",
        "x-remote-workflow-protocol": "0",
      }),
    );

    expect(result).toEqual({
      headers: { [REMOTE_WORKFLOW_PROTOCOL_HEADER]: "1" },
      ok: false,
      status: 426,
    });
  });
});

describe("runtime validation", () => {
  it("accepts workflow events and step capabilities", async () => {
    class TestWorkflow {
      async run(): Promise<void> {}
    }

    const target = createWorkflowTarget(TestWorkflow);
    await expect(target.run(event, step)).resolves.toBeUndefined();
  });

  it("rejects malformed workflow input", async () => {
    class TestWorkflow {
      async run(): Promise<void> {}
    }

    const target = createWorkflowTarget(TestWorkflow);
    await expect(
      target.run({ ...event, timestamp: "now" }, step),
    ).rejects.toThrow(z.ZodError);
    await expect(target.run(event, { do() {} })).rejects.toThrow(z.ZodError);
  });

  it("rejects invalid server paths", () => {
    class TestWorkflow {
      async run(): Promise<void> {}
    }

    expect(() =>
      serveWorkflow({
        path: "/rpc?debug",
        port: 0,
        workflow: TestWorkflow,
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects workflow classes without a run method", () => {
    class InvalidWorkflow {}

    expect(() =>
      createWorkflowTarget(InvalidWorkflow as unknown as RemoteWorkflowClass),
    ).toThrow(z.ZodError);
  });
});

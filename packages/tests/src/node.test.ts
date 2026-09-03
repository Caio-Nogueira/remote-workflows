import type {
  WorkflowEvent,
  WorkflowStep,
  WorkflowStepContext,
} from "cloudflare:workers";
import { once } from "node:events";
import { createConnection } from "node:net";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  REMOTE_WORKFLOW_PROTOCOL_HEADER,
  REMOTE_WORKFLOW_PROTOCOL_VERSION,
  type RemoteWorkflowClass,
  type RemoteWorkflowTarget,
} from "@cloudflare/remote-workflows/server";
import { serveWorkflow } from "@cloudflare/remote-workflows/node";
import {
  createRemoteWorkflowEnvironment,
} from "../../remote-workflows/src/worker/environment.js";

class FakeStep extends RpcTarget {
  async do<Output>(
    name: string,
    configOrCallback: unknown,
    maybeCallback?: unknown,
  ): Promise<Output> {
    const callback =
      typeof configOrCallback === "function"
        ? configOrCallback
        : maybeCallback;
    if (typeof callback !== "function") {
      throw new TypeError("Step callback is required.");
    }
    return await callback({
      attempt: 1,
      config: {},
      step: { count: 1, name },
    } satisfies WorkflowStepContext);
  }

  async sleep(): Promise<void> {}

  async sleepUntil(): Promise<void> {}

  async waitForEvent(): Promise<never> {
    throw new Error("No event was configured.");
  }
}

class CounterResult {
  constructor(readonly value: number) {}
}

class CounterBinding {
  #value = 1;

  async add(amount: number): Promise<CounterResult> {
    this.#value += amount;
    return new CounterResult(this.#value);
  }

  dup(): never {
    throw new Error("The binding's dup method must remain reserved.");
  }
}

const event: WorkflowEvent<{ name: string }> = {
  instanceId: "instance-1",
  payload: { name: "Ada" },
  timestamp: new Date("2026-01-01T00:00:00.000Z"),
  workflowName: "GreetingWorkflow",
};

const servers: Array<{ close(): Promise<void> }> = [];
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.terminate();
  }
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function startServer(workflow: RemoteWorkflowClass) {
  const server = serveWorkflow({ port: 0, workflow });
  servers.push(server);
  const address = await server.ready;
  return { server, url: `ws://127.0.0.1:${address.port}/rpc` };
}

async function connect(url: string) {
  const webSocket = new WebSocket(url, {
    headers: {
      [REMOTE_WORKFLOW_PROTOCOL_HEADER]: REMOTE_WORKFLOW_PROTOCOL_VERSION,
    },
  });
  clients.push(webSocket);
  await once(webSocket, "open");
  return newWebSocketRpcSession<RemoteWorkflowTarget>(
    webSocket as unknown as globalThis.WebSocket,
  );
}

async function rejectedUpgrade(
  url: string,
  headers: Record<string, string>,
): Promise<number> {
  const webSocket = new WebSocket(url, { headers });
  const [request, response] = (await once(
    webSocket,
    "unexpected-response",
  )) as [
    { destroy(): void },
    { statusCode: number },
  ];
  request.destroy();
  return response.statusCode;
}

async function malformedTargetRequest(
  port: number,
  upgrade: boolean,
): Promise<string> {
  const socket = createConnection({ host: "127.0.0.1", port });
  await once(socket, "connect");
  socket.end(
    [
      "GET http://[::1 HTTP/1.1",
      "Host: localhost",
      ...(upgrade
        ? [
            "Connection: Upgrade",
            "Upgrade: websocket",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version: 13",
          ]
        : ["Connection: close"]),
      "",
      "",
    ].join("\r\n"),
  );

  let response = "";
  for await (const chunk of socket) {
    response += chunk.toString();
  }
  return response;
}

describe("Node workflow server", () => {
  it("listens only on IPv4 loopback", async () => {
    class TestWorkflow {
      async run(): Promise<void> {}
    }

    const { server } = await startServer(TestWorkflow);

    expect(server.address?.address).toBe("127.0.0.1");
    expect(server.address?.family).toBe("IPv4");
  });

  it("forwards a step capability and callback in both directions", async () => {
    class GreetingWorkflow {
      declare readonly env: { GREETING: string };

      async run(
        remoteEvent: Readonly<WorkflowEvent<{ name: string }>>,
        step: WorkflowStep,
      ): Promise<string> {
        return await step.do("greet", async () => {
          return `${this.env.GREETING}, ${remoteEvent.payload.name}`;
        });
      }
    }

    const { url } = await startServer(GreetingWorkflow);
    const remote = await connect(url);

    const result = await remote.run(
      event,
      new FakeStep() as unknown as WorkflowStep,
      { GREETING: "Hello" },
    );

    expect(result).toBe("Hello, Ada");
    remote[Symbol.dispose]();
  });

  it("forwards generic binding capabilities and host results", async () => {
    class CounterWorkflow {
      declare readonly env: {
        COUNTER: {
          add(amount: number): Promise<{ readonly value: number }>;
        };
      };

      async run(
        _event: Readonly<WorkflowEvent<unknown>>,
        step: WorkflowStep,
      ): Promise<number> {
        return await step.do("increment", async () => {
          const result = await this.env.COUNTER.add(2);
          return await result.value;
        });
      }
    }

    const { url } = await startServer(CounterWorkflow);
    const remote = await connect(url);
    const result = await remote.run(
      event,
      new FakeStep() as unknown as WorkflowStep,
      createRemoteWorkflowEnvironment({
        COUNTER: new CounterBinding(),
      }),
    );

    expect(result).toBe(3);
    remote[Symbol.dispose]();
  });

  it("rejects a protocol mismatch before constructing the workflow", async () => {
    const construct = vi.fn();
    class TestWorkflow {
      constructor() {
        construct();
      }

      async run(): Promise<void> {}
    }

    const server = serveWorkflow({ port: 0, workflow: TestWorkflow });
    servers.push(server);
    const address = await server.ready;

    const status = await rejectedUpgrade(
      `ws://127.0.0.1:${address.port}/rpc`,
      { [REMOTE_WORKFLOW_PROTOCOL_HEADER]: "0" },
    );

    expect(status).toBe(426);
    expect(construct).not.toHaveBeenCalled();
  });

  it("rejects malformed request targets", async () => {
    class TestWorkflow {
      async run(): Promise<void> {}
    }

    const { server } = await startServer(TestWorkflow);
    const address = server.address;
    if (address === null) {
      throw new Error("Workflow server is not listening.");
    }

    const ordinaryResponse = await malformedTargetRequest(address.port, false);
    const upgradeResponse = await malformedTargetRequest(address.port, true);

    expect(ordinaryResponse).toMatch(/^HTTP\/1\.1 400 Bad Request/);
    expect(upgradeResponse).toMatch(/^HTTP\/1\.1 400 Bad Request/);
  });

  it("creates one workflow per connection", async () => {
    let constructorCalls = 0;
    class TestWorkflow {
      constructor() {
        constructorCalls += 1;
      }

      async run(): Promise<void> {}
    }

    const { url } = await startServer(TestWorkflow);
    const first = await connect(url);
    expect(constructorCalls).toBe(1);
    first[Symbol.dispose]();

    const second = await connect(url);
    expect(constructorCalls).toBe(2);
    second[Symbol.dispose]();
  });
});

import { afterEach, expect, test } from "bun:test";
import type {
  WorkflowEvent,
  WorkflowStep,
  WorkflowStepContext,
} from "cloudflare:workers";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
} from "node:http";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import { serveWorkflow } from "@cloudflare/remote-workflows/bun";
import {
  REMOTE_WORKFLOW_PROTOCOL_HEADER,
  REMOTE_WORKFLOW_PROTOCOL_VERSION,
} from "@cloudflare/remote-workflows/server";
import {
  createRemoteWorkflowEnvironment,
} from "../../remote-workflows/src/worker/environment.js";

class FakeStep extends RpcTarget {
  async do<Output>(name: string, callback: unknown): Promise<Output> {
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
}

const servers: ReturnType<typeof serveWorkflow>[] = [];
const HeaderWebSocket = WebSocket as unknown as new (
  url: string,
  options: { headers: Record<string, string> },
) => WebSocket;
const workflowHeaders = {
  [REMOTE_WORKFLOW_PROTOCOL_HEADER]: REMOTE_WORKFLOW_PROTOCOL_VERSION,
};

function createWebSocket(
  url: string,
  headers: Record<string, string>,
): WebSocket {
  return new HeaderWebSocket(url, { headers });
}

async function openWebSocket(
  url: string,
  headers: Record<string, string> = workflowHeaders,
): Promise<WebSocket> {
  const webSocket = createWebSocket(url, headers);
  await new Promise<void>((resolve, reject) => {
    webSocket.addEventListener("open", () => resolve(), { once: true });
    webSocket.addEventListener("error", reject, { once: true });
  });
  return webSocket;
}

interface UpgradeRejection {
  headers: IncomingHttpHeaders;
  status: number;
}

async function requestWebSocketUpgrade(
  url: string,
  headers: Record<string, string>,
): Promise<UpgradeRejection> {
  const parsedUrl = new URL(url);
  return await new Promise<UpgradeRejection>((resolve, reject) => {
    const request = httpRequest({
      agent: false,
      headers: {
        ...headers,
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        Upgrade: "websocket",
      },
      hostname: parsedUrl.hostname,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      port: parsedUrl.port,
    });
    request.once("error", reject);
    request.once("response", (response) => {
      response.destroy();
      if (response.statusCode === undefined) {
        reject(new Error("WebSocket rejection did not include a status."));
        return;
      }
      resolve({ headers: response.headers, status: response.statusCode });
    });
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      reject(new Error("WebSocket upgrade unexpectedly succeeded."));
    });
    request.end();
  });
}

async function closeWebSocket(webSocket: WebSocket): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    webSocket.addEventListener("close", () => resolve(), { once: true });
  });
  webSocket.close();
  await closed;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

test("Bun serves a bidirectional workflow session", async () => {
  class GreetingWorkflow {
    declare readonly env: {
      COUNTER: {
        add(amount: number): Promise<{ readonly value: number }>;
      };
      GREETING: string;
    };

    async run(
      event: Readonly<WorkflowEvent<{ name: string }>>,
      step: WorkflowStep,
    ): Promise<string> {
      return await step.do("greet", async () => {
        const counter = await this.env.COUNTER.add(1);
        const value = await counter.value;
        return `${this.env.GREETING}, ${event.payload.name}:${value}`;
      });
    }
  }

  const server = serveWorkflow({
    port: 0,
    workflow: GreetingWorkflow,
  });
  servers.push(server);
  expect(server.hostname).toBe("127.0.0.1");
  const webSocket = await openWebSocket(
    `ws://127.0.0.1:${server.port}/rpc`,
  );
  const remote = newWebSocketRpcSession<{
    run(
      event: unknown,
      step: WorkflowStep,
      env: Record<string, unknown>,
    ): Promise<string>;
  }>(webSocket);

  const result = await remote.run(
    {
      instanceId: "instance",
      payload: { name: "Bun" },
      timestamp: new Date(),
      workflowName: "GreetingWorkflow",
    },
    new FakeStep() as unknown as WorkflowStep,
    createRemoteWorkflowEnvironment({
      COUNTER: new CounterBinding(),
      GREETING: "Hello",
    }),
  );

  expect(result).toBe("Hello, Bun:2");
  remote[Symbol.dispose]();
});

test("Bun rejects protocol mismatches before workflow construction", async () => {
  let constructorCalls = 0;
  class TestWorkflow {
    constructor() {
      constructorCalls += 1;
    }

    async run(): Promise<void> {}
  }

  const server = serveWorkflow({
    port: 0,
    workflow: TestWorkflow,
  });
  servers.push(server);

  const rejection = await requestWebSocketUpgrade(
    `ws://127.0.0.1:${server.port}/rpc`,
    { [REMOTE_WORKFLOW_PROTOCOL_HEADER]: "0" },
  );

  expect(rejection.status).toBe(426);
  expect(constructorCalls).toBe(0);
});

test("Bun creates one workflow per connection", async () => {
  let constructorCalls = 0;
  class TestWorkflow {
    constructor() {
      constructorCalls += 1;
    }

    async run(): Promise<void> {}
  }

  const server = serveWorkflow({
    port: 0,
    workflow: TestWorkflow,
  });
  servers.push(server);
  const url = `ws://127.0.0.1:${server.port}/rpc`;
  const first = await openWebSocket(url);
  expect(constructorCalls).toBe(1);

  await closeWebSocket(first);
  const second = await openWebSocket(url);
  expect(constructorCalls).toBe(2);

  await closeWebSocket(second);
});

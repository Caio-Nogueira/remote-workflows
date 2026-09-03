import { newBunWebSocketRpcSession, type RpcStub } from "capnweb";
import { workflowServerOptionsSchema } from "../schemas.js";
import {
  createWorkflowTarget,
  validateUpgrade,
  type RemoteWorkflowClass,
} from "../server/index.js";

export type { RemoteWorkflowClass } from "../server/index.js";

export interface ServeWorkflowOptions {
  onError?: (error: unknown) => void;
  path?: `/${string}`;
  port: number;
  workflow: RemoteWorkflowClass;
}

interface WorkflowSocketTransport {
  dispatchClose(code: number, reason: string): void;
  dispatchError(error: unknown): void;
  dispatchMessage(message: string | Buffer): void;
}

interface WorkflowSocketData {
  session?: RpcStub<object>;
  transport?: WorkflowSocketTransport;
}

export function serveWorkflow(options: ServeWorkflowOptions) {
  const { path, port } = workflowServerOptionsSchema.parse(options);
  const server = Bun.serve<WorkflowSocketData>({
    hostname: "127.0.0.1",
    port,
    async fetch(request, server) {
      if (new URL(request.url).pathname !== path) {
        return new Response("Not Found", { status: 404 });
      }

      const validation = validateUpgrade(request);
      if (!validation.ok) {
        return new Response(null, {
          ...(validation.headers ? { headers: validation.headers } : {}),
          status: validation.status,
        });
      }

      const upgraded = server.upgrade(request, { data: {} });
      return upgraded
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 500 });
    },
    websocket: {
      perMessageDeflate: false,
      open(webSocket) {
        try {
          const target = createWorkflowTarget(options.workflow);
          const session = newBunWebSocketRpcSession(webSocket, target);
          webSocket.data.session = session.stub;
          webSocket.data.transport = session.transport;
        } catch (error) {
          options.onError?.(error);
          webSocket.close(1011, "Workflow initialization failed");
        }
      },
      message(webSocket, message) {
        const transport = webSocket.data.transport;
        if (!transport) {
          webSocket.close(1011, "Workflow session is unavailable");
          return;
        }
        transport.dispatchMessage(message);
      },
      close(webSocket, code, reason) {
        webSocket.data.transport?.dispatchClose(code, reason);
        webSocket.data.session?.[Symbol.dispose]();
      },
      error(
        webSocket: Bun.ServerWebSocket<WorkflowSocketData>,
        error: Error,
      ) {
        webSocket.data.transport?.dispatchError(error);
      },
    } as Bun.WebSocketHandler<WorkflowSocketData> & {
      error(
        webSocket: Bun.ServerWebSocket<WorkflowSocketData>,
        error: Error,
      ): void;
    },
  });

  return server;
}

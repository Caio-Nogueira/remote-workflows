import { createServer, STATUS_CODES, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import { WebSocketServer } from "ws";
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

export interface NodeWorkflowServer {
  readonly address: AddressInfo | null;
  readonly ready: Promise<AddressInfo>;
  close(): Promise<void>;
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) {
      headers.append(name, value);
    }
  }
  return headers;
}

function requestPath(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? "/", "http://remote-workflow").pathname;
  } catch {
    return undefined;
  }
}

function rejectUpgrade(
  socket: Duplex,
  status: number,
  headers: Record<string, string> = {},
): void {
  const body = STATUS_CODES[status] ?? "Request rejected";
  const lines = [
    `HTTP/1.1 ${status} ${body}`,
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    "",
    body,
  ];
  socket.end(lines.join("\r\n"));
}

export function serveWorkflow(
  options: ServeWorkflowOptions,
): NodeWorkflowServer {
  const { path, port } = workflowServerOptionsSchema.parse(options);
  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });
  const activeSessionClosures = new Set<Promise<void>>();
  let closePromise: Promise<void> | undefined;

  const httpServer = createServer((request, response) => {
    const requestedPath = requestPath(request);
    if (requestedPath === undefined) {
      response.writeHead(400).end("Bad Request");
      return;
    }
    if (requestedPath !== path) {
      response.writeHead(404).end("Not Found");
      return;
    }
    response
      .writeHead(426, { Connection: "close", Upgrade: "websocket" })
      .end("Upgrade Required");
  });

  const handleUpgrade = async (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> => {
    const requestedPath = requestPath(request);
    if (requestedPath === undefined) {
      rejectUpgrade(socket, 400);
      return;
    }
    if (requestedPath !== path) {
      rejectUpgrade(socket, 404);
      return;
    }

    const validation = validateUpgrade({
      headers: requestHeaders(request),
      method: request.method ?? "GET",
    });
    if (!validation.ok) {
      rejectUpgrade(socket, validation.status, validation.headers);
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      let session: RpcStub<object> | undefined;
      let resolveClosure: () => void;
      const closure = new Promise<void>((resolve) => {
        resolveClosure = resolve;
      });
      activeSessionClosures.add(closure);
      webSocket.once("close", () => {
        session?.[Symbol.dispose]();
        activeSessionClosures.delete(closure);
        resolveClosure();
      });

      try {
        const target = createWorkflowTarget(options.workflow);
        session = newWebSocketRpcSession(
          webSocket as unknown as WebSocket,
          target,
        );
      } catch (error) {
        options.onError?.(error);
        webSocket.close(1011, "Workflow initialization failed");
      }
    });
  };

  httpServer.on("error", (error) => options.onError?.(error));
  httpServer.on("upgrade", (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    void handleUpgrade(request, socket, head).catch((error) => {
      options.onError?.(error);
      rejectUpgrade(socket, 500);
    });
  });

  const ready = new Promise<AddressInfo>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(port, "127.0.0.1", () => {
      httpServer.off("error", onError);
      const address = httpServer.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Workflow server did not open a TCP listener."));
        return;
      }
      resolve(address);
    });
  });

  return {
    get address() {
      const address = httpServer.address();
      return typeof address === "string" ? null : address;
    },
    ready,
    close() {
      closePromise ??= (async () => {
        const sessionClosures = [...activeSessionClosures];
        for (const client of webSocketServer.clients) {
          client.terminate();
        }
        const httpClosure = new Promise<void>((resolve, reject) => {
          httpServer.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
          httpServer.closeAllConnections();
        });
        await Promise.all([httpClosure, ...sessionClosures]);
      })();
      return closePromise;
    },
  };
}

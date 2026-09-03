import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import {
  REMOTE_WORKFLOW_PROTOCOL_HEADER,
  REMOTE_WORKFLOW_PROTOCOL_VERSION,
} from "../server/protocol.js";
import type { RemoteWorkflowTarget } from "../server/target.js";
import { createRemoteWorkflowEnvironment } from "./environment.js";

interface VpcServiceBinding {
  fetch(input: Request): Promise<Response>;
}

export interface RemoteWorkflowRelayEnv {
  REMOTE_WORKFLOW_PATH: string;
  REMOTE_WORKFLOW_SERVER: VpcServiceBinding;
}

export class RemoteWorkflow extends WorkflowEntrypoint<
  RemoteWorkflowRelayEnv,
  unknown
> {
  override async run(
    event: Readonly<WorkflowEvent<unknown>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const response = await this.env.REMOTE_WORKFLOW_SERVER.fetch(
      new Request(`http://127.0.0.1${this.env.REMOTE_WORKFLOW_PATH}`, {
        headers: {
          [REMOTE_WORKFLOW_PROTOCOL_HEADER]: REMOTE_WORKFLOW_PROTOCOL_VERSION,
          Upgrade: "websocket",
        },
      }),
    );
    if (response.status !== 101 || !response.webSocket) {
      throw new Error(
        `Remote workflow WebSocket upgrade failed with status ${response.status}.`,
      );
    }

    const remote: RpcStub<RemoteWorkflowTarget> = newWebSocketRpcSession(
      response.webSocket,
    );
    response.webSocket.accept();
    try {
      return await remote.run(
        event,
        step,
        createRemoteWorkflowEnvironment(this.env),
      );
    } finally {
      remote[Symbol.dispose]();
    }
  }
}

import { fileURLToPath } from "node:url";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type * as Redacted from "effect/Redacted";
import * as Effect from "effect/Effect";
import {
  remoteWorkflowPropsSchema,
  type RemoteWorkflowProps,
} from "../schemas.js";

export type { RemoteWorkflowProps } from "../schemas.js";
export type RemoteWorkflowOrigin = RemoteWorkflowProps["origin"];

interface RemoteWorkflowBaseOutput {
  relayWorker: unknown;
  vpcService: unknown;
  tunnel: {
    id: Alchemy.Output<string, never>;
    token: Alchemy.Output<Redacted.Redacted<string>, never>;
  };
  server: {
    host: "127.0.0.1";
    path: RemoteWorkflowProps["origin"]["path"];
    port: number;
  };
}

export interface RemoteWorkflowOutput<Params = unknown>
  extends RemoteWorkflowBaseOutput {
  workflow: Cloudflare.WorkflowLike<Params>;
}

export interface NamedRemoteWorkflowBinding<Params = unknown> {
  readonly name: string;
  readonly Params?: Params;
  bind(worker: Cloudflare.Worker, bindingName: string): Effect.Effect<void>;
}

export interface NamedRemoteWorkflowOutput<Params = unknown>
  extends RemoteWorkflowBaseOutput {
  workflow: NamedRemoteWorkflowBinding<Params>;
  workflowName: string;
}

const relayWorkerMain = fileURLToPath(
  new URL("../worker/index.js", import.meta.url),
);
const relayClassName = "RemoteWorkflow";

export function RemoteWorkflow<Params = unknown>(
  id: string,
  props: RemoteWorkflowProps & { workflowName: string },
): Effect.Effect<
  NamedRemoteWorkflowOutput<Params>,
  never,
  Cloudflare.Providers
>;
export function RemoteWorkflow<Params = unknown>(
  id: string,
  props: RemoteWorkflowProps,
): Effect.Effect<RemoteWorkflowOutput<Params>, never, Cloudflare.Providers>;
export function RemoteWorkflow<Params = unknown>(
  id: string,
  props: RemoteWorkflowProps,
): Effect.Effect<
  RemoteWorkflowOutput<Params> | NamedRemoteWorkflowOutput<Params>,
  never,
  Cloudflare.Providers
> {
  return Effect.gen(function* () {
    const input = remoteWorkflowPropsSchema.parse(props);
    const adoption = input.adopt === undefined ? {} : { adopt: input.adopt };
    const tunnel = yield* Cloudflare.Tunnel.Tunnel(`${id}Tunnel`, adoption);
    const vpcService = yield* Cloudflare.VpcService.VpcService(
      `${id}WorkflowServer`,
      {
        ...adoption,
        serviceType: "http",
        httpPort: input.origin.port,
        host: {
          ipv4: "127.0.0.1",
          network: { tunnelId: tunnel.tunnelId },
        },
      },
    );
    const generatedRegistration =
      input.workflowName === undefined
        ? {
            REMOTE_WORKFLOW_REGISTRATION: Cloudflare.Workflow(
              `${id}Registration`,
              { className: relayClassName },
            ),
          }
        : {};
    const relayWorker = yield* Cloudflare.Worker(`${id}Relay`, {
      compatibility: { date: "2026-09-01" },
      env: {
        REMOTE_WORKFLOW_PATH: input.origin.path,
        REMOTE_WORKFLOW_SERVER: vpcService,
        ...generatedRegistration,
      },
      main: relayWorkerMain,
      workersDev: false,
    });
    const base = {
      relayWorker,
      vpcService,
      tunnel: {
        id: tunnel.tunnelId,
        token: tunnel.token,
      },
      server: {
        host: "127.0.0.1" as const,
        path: input.origin.path,
        port: input.origin.port,
      },
    };

    if (input.workflowName !== undefined) {
      const workflowName = input.workflowName;
      const registration = Cloudflare.Workflows.WorkflowResource(
        `${id}Registration`,
        {
          className: relayClassName,
          scriptName: relayWorker.workerName,
          workflowName,
        },
      ) as unknown as Effect.Effect<unknown, never, Cloudflare.Providers>;
      yield* registration;

      return {
        ...base,
        workflow: {
          name: workflowName,
          bind: (worker, bindingName) =>
            worker.bind`${id}Workflow:${bindingName}`({
              bindings: [
                {
                  type: "workflow",
                  name: bindingName,
                  workflowName,
                  className: relayClassName,
                  scriptName: relayWorker.workerName,
                },
              ],
            }),
        },
        workflowName,
      };
    }

    return {
      ...base,
      workflow: Cloudflare.Workflow<Params>(`${id}Workflow`, {
        className: relayClassName,
        scriptName: relayWorker.workerName,
      }),
    };
  });
}

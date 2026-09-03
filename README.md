# Remote Workflows

Remote Workflows keeps Cloudflare Workflow state in Cloudflare and runs the workflow implementation on a private Node.js or Bun server. A relay Worker forwards the engine's native `WorkflowStep` and configured Worker bindings through Cap'n Web. The library does not copy or reimplement step or binding methods.

This package is experimental. Workers VPC WebSocket transport and full Workflow lifecycle behavior still need validation against a live Cloudflare account.

## Install

```sh
npm install @cloudflare/remote-workflows
npm install --save-dev @cloudflare/workers-types
```

Install the Alchemy peers only when using the Alchemy construct:

```sh
bun add alchemy@latest effect@rc @effect/platform-node@rc
```

## Run a Node server

```ts
import { serveWorkflow } from "@cloudflare/remote-workflows/node";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

class GreetingWorkflow {
  async run(
    event: Readonly<WorkflowEvent<{ name: string }>>,
    step: WorkflowStep,
  ): Promise<string> {
    return await step.do("greet", async () => {
      return `Hello, ${event.payload.name}`;
    });
  }
}

const server = serveWorkflow({
  port: 8789,
  path: "/rpc",
  workflow: GreetingWorkflow,
});

await server.ready;
```

The server always listens on `127.0.0.1`. Run `cloudflared` in the same machine, pod, or network namespace, and do not publish the server port. The package treats that local namespace as the trust boundary. Protocol validation happens before the workflow constructor runs.

The server creates one workflow instance per connection. Cap'n Web owns the RPC session lifecycle.

## Run a Bun server

The Bun adapter has the same options and returns the `Bun.Server` created by `Bun.serve()`:

```ts
import { serveWorkflow } from "@cloudflare/remote-workflows/bun";

serveWorkflow({
  port: 8789,
  path: "/rpc",
  workflow: GreetingWorkflow,
});
```

## Deploy with Alchemy

```ts
import { RemoteWorkflow } from "@cloudflare/remote-workflows/alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const artifacts = yield* Cloudflare.R2.Bucket("Artifacts");
  const orders = yield* RemoteWorkflow<{ name: string }>("Orders", {
    env: {
      ARTIFACTS: artifacts,
    },
    origin: {
      port: 8789,
      path: "/rpc",
    },
  });

  yield* Cloudflare.Worker("Api", {
    main: "./src/api.ts",
    env: {
      ORDERS: orders.workflow,
    },
  });
});
```

The construct creates:

- A remotely managed Cloudflare Tunnel with a redacted connector token.
- A VPC Service fixed to `127.0.0.1` and the configured port.
- A relay Worker with `workersDev: false` and no routes or domain.
- A Cloudflare Workflow registration for the relay's `RemoteWorkflow` export.

It returns the Workflow binding, Cloudflare resources, connector token under `tunnel.token`, and loopback server settings under `server`.

## Worker bindings

Every relay binding is forwarded to the remote workflow, including the relay's own transport bindings. With Alchemy, declare additional bindings through the construct's `env` property. Other deployment tools can bind resources directly to the relay Worker.

The outer environment crosses by value. Primitive variables remain ordinary values, while objects with custom prototypes are wrapped in generic Cap'n Web capabilities. The remote server installs that environment as a read-only `env` property on the workflow instance:

```ts
interface Env {
  ARTIFACTS: R2Bucket;
}

class ArtifactWorkflow {
  declare readonly env: Env;

  async run(
    event: Readonly<WorkflowEvent<{ key: string; value: string }>>,
    step: WorkflowStep,
  ): Promise<void> {
    await step.do("write artifact", async () => {
      await this.env.ARTIFACTS.put(
        event.payload.key,
        event.payload.value,
      );
    });
  }
}
```

The binding and any host objects it returns remain in the relay Worker. A proxy-backed `RpcTarget` forwards methods and getters to the native object and recursively wraps unsupported host results as more capabilities. Cap'n Web serializes method arguments, plain return values, and supported built-ins normally.

Remote method calls are asynchronous. Cap'n Web promise pipelining preserves common fluent calls, but properties on a returned host capability must be awaited. Symbol APIs and names reserved by Cap'n Web stubs are not available through the generic wrapper.

Set `workflowName` when the account-global Cloudflare Workflow name must be explicit:

```ts
const orders = yield* RemoteWorkflow<{ name: string }>("Orders", {
  origin: {
    port: 8789,
    path: "/rpc",
  },
  workflowName: "orders-production",
});
```

An explicit name is limited to 64 characters and must match `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$`. Changing it changes the durable Workflow identity, and the prior Workflow may require explicit cleanup after its instances are no longer needed. Alchemy 2.0.0-beta.76 does not preserve an explicit physical name through its `WorkflowLike` async binding path, so named workflows expose `workflow.bind(worker, bindingName)` instead:

```ts
const api = yield* Cloudflare.Worker("Api", {
  main: "./src/api.ts",
});

yield* orders.workflow.bind(api, "ORDERS");
```

Run the connector in the same network namespace as the workflow server:

```sh
cloudflared tunnel run --token "$CF_TUNNEL_TOKEN"
```

When Alchemy uses local state, the package executable can read the managed Tunnel resource and start the connector without printing its token:

```sh
remote-workflows-connect --stack MyStack --workflow Orders
```

Pass `--stage <stage>` or set `ALCHEMY_STAGE` when the stack has more than one deployed stage.

On a VM, run both processes on the same machine. In Kubernetes, run them in the same Pod. Separate Docker containers must share a network namespace because ordinary bridge networking cannot reach another container's loopback listener.

## Workflow types

Workflow implementations use the official Cloudflare types through type-only imports from `cloudflare:workers`. Wrangler-generated types or `@cloudflare/workers-types` must provide that module during type checking. Do not extend `WorkflowEntrypoint` in Node or Bun because it is a workerd runtime class.

The forwarded `WorkflowStep` is the engine-owned RPC capability. Calls such as `step.do`, `step.sleep`, `step.sleepUntil`, and `step.waitForEvent` go back to the Workflows engine. Callbacks, rollback handlers, and dynamic retry-delay functions cross the same connection in the other direction.

## Replay and connection loss

Treat `run()` as replayable orchestration. Put side effects in step callbacks and make those side effects idempotent. Code outside a step can run again whenever the Workflows engine starts a new lifetime.

The relay makes one connection attempt per Workflow invocation. A disconnect invalidates callbacks and the native step capability. Whether Cloudflare starts a fresh Workflow lifetime depends on the engine's classification of that failure.

A sleep, retry delay, event wait, restart, or eviction may end the current relay invocation. The remote run then fails with a closed session. On a later engine lifetime, the relay opens a new session and starts from the beginning. Completed steps should return their cached durable results from Cloudflare.

## Supported values

Values must be supported by both Workers RPC and Cap'n Web. Current restrictions include:

- `Map`, `Set`, aliases, and cyclic object graphs are not supported.
- Application classes must extend `RpcTarget` to cross by reference.
- Streams are supported by Cap'n Web, but interrupted stream behavior depends on Workflow retry semantics.
- Custom error prototypes may not survive both RPC systems. Test `NonRetryableError` behavior before depending on it.

## Development

```sh
pnpm install
pnpm check
pnpm test
pnpm test:bun
pnpm build
```

The local test suite covers protocol negotiation, schema validation, per-connection construction, and callback forwarding in both directions. Live tests for Workers VPC WebSockets and native Workflow replay remain separate because they require Cloudflare resources and a running `cloudflared` connector.

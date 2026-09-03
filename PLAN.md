# Remote Workflows Vite and Wrangler integration plan

## Summary

Remote Workflows will integrate with the official Cloudflare Vite plugin and Wrangler so customers use the normal Worker development and deployment flow:

```sh
vite
vite build
wrangler deploy
```

Customers declare remote workflows in `vite.config.ts`. The Vite integration builds the application Worker, private relay Workers, and a private-origin launcher. It also emits a declarative Remote Workflows deployment section in the generated Wrangler configuration.

These commands own the Cloudflare application lifecycle. An unmanaged production origin still needs a long-lived process manager and the standard `wrangler tunnel run` or dashboard service-install flow. No Remote Workflows-specific CLI is introduced.

Wrangler consumes that generated configuration during `wrangler deploy`. It provisions or updates the Tunnel, VPC Service, relay Workers, Workflow registrations, and application Workflow bindings in dependency order.

No Remote Workflows CLI is added. No customer-authored Alchemy stack is required. The existing `/alchemy` export remains available as a separate experimental provisioning option and is not removed or used behind the Vite path.

## Core decisions

1. The customer-facing commands remain Vite and Wrangler commands.
2. `vite build` is credential-free and does not mutate Cloudflare resources.
3. `wrangler deploy` owns authenticated resource provisioning and Worker upload.
4. `vite` development mode may provision a developer-scoped remote graph because remote bindings require deployed Cloudflare resources.
5. The Remote Workflows package contributes through a first-party Cloudflare Vite integration API.
6. Wrangler automatic provisioning is extended to understand the complete Remote Workflows resource graph.
7. Workflow declarations are explicit in Vite configuration. Source scanning is not used.
8. Workflow implementation modules are imported only by the generated private-origin launcher.
9. One origin group owns one Tunnel and connector, one active loopback VPC Service, and optional candidate or draining VPC Service generations during updates.
10. Each declared workflow gets one private relay Worker and one Workflow registration using the shared VPC Service.
11. The generated origin launcher serves all declared workflows on one loopback port and one path per workflow.
12. Connector tokens never enter build output, generated Wrangler configuration, Worker bindings, or normal logs.
13. Removing a declaration does not silently delete durable Workflow state.
14. The existing runtime adapters and `/alchemy` export remain additive and independently usable.

## Goals

The integration must:

- Let customers declare remote workflows in `vite.config.ts`.
- Require no Remote Workflows-specific CLI.
- Require no customer-authored Alchemy stack.
- Require no hand-written Wrangler configuration for generated relays or bindings.
- Use the official Cloudflare Vite plugin for development, build, and generated deployment configuration.
- Use Wrangler for Cloudflare authentication, provisioning, upload, and deletion.
- Build generated relay Workers as auxiliary Workers.
- Build a Node or Bun launcher for private workflow implementations.
- Provision one Tunnel and VPC Service for the shared origin.
- Provision one relay Worker and Workflow registration per declared workflow.
- Add typed Workflow bindings to the application Worker.
- Start the private origin and Tunnel connector during Vite development.
- Keep the private server bound to `127.0.0.1`.
- Preserve stable Workflow identity across ordinary code and binding changes.
- Recover safely from interrupted deploys.
- Keep durable Workflow deletion explicit.
- Work in local development and Workers Builds.

## Non-goals

The first release will not:

- Provision an arbitrary production VM, Kubernetes cluster, or container platform.
- Start a production connector on an ephemeral Workers Builds runner.
- Mutate Cloudflare resources during `vite build`, `vite preview`, tests, or type checking.
- Discover workflows by scanning application source.
- Import Node or Bun workflow code while Vite configuration loads.
- Store Tunnel connector tokens in generated files.
- Support a connector on a different host from the loopback workflow server.
- Delete a Workflow registration because its declaration is temporarily absent.
- Replace or remove the public `/alchemy` construct.
- Add a `remote-workflows` command.
- Depend on private Vite plugin or Wrangler APIs after the required first-party extension points are added.

## Customer experience

### Install

```sh
npm install @cloudflare/remote-workflows
npm install --save-dev vite wrangler @cloudflare/vite-plugin
```

The runtime package adds a `/vite` export. Vite, Wrangler, and the official Cloudflare Vite plugin remain peer or development dependencies in the customer project.

### Configure Vite

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import { remoteWorkflows } from "@cloudflare/remote-workflows/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({
      config: {
        name: "orders-api",
        main: "./src/api.ts",
        compatibility_date: "2026-09-02",
      },
      integrations: [
        remoteWorkflows({
          origin: {
            port: 8789,
            runtime: "node",
          },
          workflows: {
            ORDERS: {
              entrypoint: "./src/workflows/orders.ts",
              id: "orders",
            },
          },
        }),
      ],
    }),
  ],
});
```

`integrations` is a new first-party Cloudflare Vite plugin extension point. It lets packages contribute Worker environments, generated config, development services, build artifacts, and deployment metadata before the Cloudflare plugin resolves its environment graph.

The `workflows` object key is the application Worker binding name. `id` is the stable durable identity and does not change when a source file or binding is renamed.

### Implement the workflow

```ts
import { defineRemoteWorkflow } from "@cloudflare/remote-workflows";

export default defineRemoteWorkflow<
  { orderId: string },
  void
>(() => ({
  async run(event, step) {
    await step.do("process order", async () => {
      await processOrder(event.payload.orderId);
    });
  },
}));
```

`defineRemoteWorkflow()` is a typed identity helper. It returns the factory unchanged and lets generated declarations extract the payload type.

### Application Worker

```ts
export default {
  async fetch(request, env): Promise<Response> {
    const params = await request.json();
    const instance = await env.ORDERS.create({ params });

    return Response.json({
      id: instance.id,
      status: await instance.status(),
    });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
```

The Vite integration generates the `Cloudflare.Env` augmentation for `ORDERS`.

### Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "deploy": "vite build && wrangler deploy",
    "preview": "vite preview"
  }
}
```

No Remote Workflows-specific command family is introduced. Local development needs only `vite`. An unmanaged production origin also runs the standard Wrangler Tunnel command under its process manager; a managed origin integration may automate that step.

## Public Vite configuration

```ts
interface RemoteWorkflowsOptions {
  origin: RemoteWorkflowOrigin;
  workflows: Record<string, RemoteWorkflowDeclaration>;
}

interface RemoteWorkflowOrigin {
  id?: string;
  port: number;
  runtime: "node" | "bun";
}

interface RemoteWorkflowDeclaration {
  entrypoint: string;
  id: string;
  limits?: RemoteWorkflowLimits;
  path?: `/${string}`;
}
```

Default origin ID:

```text
default
```

Default path:

```text
/__remote-workflows/<workflow-id>
```

The integration rejects duplicate IDs, duplicate paths, invalid binding names, invalid ports, missing entrypoints, and reserved paths during Vite configuration.

## First-party Vite integration API

The current Cloudflare Vite plugin accepts programmatic config and auxiliary Workers, but a sibling plugin cannot safely add environments after `cloudflare()` has resolved its plugin config.

Add a public integration contract to `@cloudflare/vite-plugin`:

```ts
interface CloudflareViteIntegration {
  name: string;
  configure(
    context: CloudflareIntegrationContext,
  ): CloudflareIntegrationContribution | Promise<CloudflareIntegrationContribution>;
  prepareDev?(
    context: CloudflarePrepareDevContext,
  ): CloudflareDevContribution | Promise<CloudflareDevContribution>;
  configureServer?(
    context: CloudflareDevContext,
  ): void | Disposable | Promise<void | Disposable>;
  build?(
    context: CloudflareBuildContext,
  ): void | Promise<void>;
}
```

`prepareDev` runs before Worker environments start. Its context exposes a public typed Wrangler service:

```ts
interface CloudflarePrepareDevContext {
  environment: string;
  wrangler: {
    provisionRemoteWorkflows(input: {
      declarations: RemoteWorkflowDeployment[];
      developerId?: string;
      environment: string;
      projectId: string;
    }): Promise<ResolvedRemoteWorkflowBindings>;
    runTunnel(tunnelId: string): Promise<Disposable>;
  };
}
```

This lets an integration reconcile developer resources, receive real binding IDs, and start the connector before the application Worker environment is created.

A contribution may contain:

- Entry Worker config patches.
- Auxiliary Worker declarations.
- Generated binding type declarations.
- Development services and cleanup handlers.
- Additional build artifacts.
- Declarative deployment metadata for Wrangler.

The official plugin merges all contributions before it creates Vite environments. It rejects binding collisions, environment-name collisions, incompatible config patches, and duplicate deployment resource identities.

The integration API must be public, versioned, and covered by workers-sdk compatibility tests.

## Build behavior

### `vite build`

The build remains deterministic:

```text
source + Vite config -> application bundle + relay bundles + origin artifact + generated deployment config
```

It does not:

- Read Cloudflare credentials.
- Resolve an account ID.
- Call Cloudflare APIs.
- Create a Tunnel or VPC Service.
- Fetch a connector token.
- Start `cloudflared`.
- Upload Workers.

The Vite integration generates:

```text
.cloudflare/
├── output/
│   └── generated Worker build output
└── remote-workflows/
    ├── manifest.json
    ├── origin/
    │   └── artifact/
    │       ├── launcher.js
    │       ├── launcher.js.map
    │       ├── package.json
    │       └── dependencies.lock.json
    └── relays/
        └── orders/
            └── worker.js
```

The generated Wrangler deployment configuration contains a declarative Remote Workflows section, not resolved account resource IDs or tokens.

## Generated deployment model

The Vite plugin emits a first-party Wrangler configuration shape:

```json
{
  "name": "orders-api",
  "main": ".cloudflare/output/application/worker.js",
  "remote_workflows": [
    {
      "binding": "ORDERS",
      "id": "orders",
      "origin": {
        "group": "default",
        "host": "127.0.0.1",
        "port": 8789,
        "path": "/__remote-workflows/orders"
      },
      "relay": {
        "main": ".cloudflare/remote-workflows/relays/orders/worker.js",
        "class_name": "RemoteWorkflow",
        "compatibility_date": "2026-01-20"
      }
    }
  ]
}
```

`remote_workflows` is build-time desired state. Wrangler resolves it to physical Cloudflare resources during deployment.

The generated config is environment-specific and participates in the existing `.wrangler/deploy/config.json` redirection used by the Cloudflare Vite plugin.

## Generated origin artifact

The integration bundles declared workflow factories into one Node or Bun origin artifact.

```text
127.0.0.1:8789
├── /__remote-workflows/orders
└── /__remote-workflows/billing
```

Each path maps to one `RemoteWorkflowFactory`. Every accepted connection receives a fresh implementation. Closing a connection disposes only that implementation.

The launcher reads `REMOTE_WORKFLOWS_PORT` as a runtime override and otherwise uses the configured base port. It embeds the manifest revision and reports the effective port and revision through readiness. Wrangler uses the override for candidate generations without rebuilding the artifact.

The artifact directory includes:

- The generated launcher.
- Source maps.
- Runtime metadata.
- Pinned external dependency metadata.
- A manifest revision.
- A protocol version.

JavaScript runtime dependencies are bundled by default. Native dependencies remain explicit production dependencies and must be installed on the origin host.

The existing `serveWorkflow()` APIs remain available for customers who do not use Vite.

## Generated binding types

The Vite integration generates a declaration using type-only imports:

```ts
import type { Workflow } from "cloudflare:workers";
import type { RemoteWorkflowPayload } from "@cloudflare/remote-workflows/types";

type OrdersFactory = typeof import("./src/workflows/orders").default;

declare global {
  namespace Cloudflare {
    interface Env {
      ORDERS: Workflow<RemoteWorkflowPayload<OrdersFactory>>;
    }
  }
}
```

The generated path is included by the Cloudflare Vite plugin's existing type-generation flow. An incompatible existing binding type fails type checking rather than being overwritten.

## Cloudflare resource graph

One origin group owns shared connectivity:

```text
Tunnel
  -> VPC Service at 127.0.0.1:<origin-port>
       -> Orders relay Worker
            -> Orders Workflow registration
       -> Billing relay Worker
            -> Billing Workflow registration

Application Worker
  -> ORDERS Workflow binding
  -> BILLING Workflow binding
```

The relay Workers have:

- `workers_dev: false`.
- Preview URLs disabled.
- No routes or custom domains.
- One shared VPC Service binding.
- One workflow path.
- Protocol and receiver limit variables.

The Tunnel has no public hostname or ingress rule. It exists only as the private network path used by Workers VPC.

## Wrangler provisioning

Wrangler automatic provisioning currently supports several binding resources but not the complete Remote Workflows graph. Extend its provisioning layer with a `RemoteWorkflowProvisioner`.

The provisioner owns:

- Tunnel creation and lookup.
- VPC Service creation and update.
- Private relay Worker upload.
- Workflow registration.
- Application Workflow binding resolution.
- Connector health lookup.
- Resource retirement and explicit deletion.

The provisioner receives the generated `remote_workflows` declarations and current deployment environment. It returns resolved Worker bindings only after required resources exist.

## `wrangler deploy` flow

```text
vite build
  -> generated config with remote_workflows declarations
  -> wrangler deploy
      -> provision shared Tunnel
      -> prepare candidate VPC Service
      -> upload candidate relay versions
      -> verify candidate connector and origin revision through preview
      -> deploy relay versions
      -> register Workflows
      -> resolve application Workflow bindings
      -> upload application Worker
```

Detailed order:

1. Read the redirected generated configuration.
2. Validate every Remote Workflow declaration.
3. Resolve account, Worker name, and environment identity.
4. Read owned and observed resources.
5. Create the Tunnel when it does not exist.
6. Create or reuse a candidate loopback VPC Service generation.
7. Upload candidate relay Worker versions bound to that service without deploying those versions.
8. Record the graph as prepared and invoke the candidate relay readiness handler through a Wrangler remote preview session.
9. Stop before relay version deployment, Workflow registration, or application upload when the candidate origin is not ready.
10. Deploy each verified candidate relay version.
11. Create or update each Workflow registration.
12. Resolve the application Worker's native Workflow bindings.
13. Upload the application Worker.
14. Mark the candidate generation active and retain the previous generation for draining.
15. Record resolved resources through Wrangler provisioning state.
16. Report created, reused, updated, active, draining, and retired resources.

If upload fails after provisioning, the resources remain owned and are reused on the next `wrangler deploy`.

Wrangler does not blindly delete a graph during failed deployment rollback.

## Resource identity and provisioning state

Resource identity is derived during deployment from:

```text
Cloudflare account ID
application Worker name
Wrangler environment
developer discriminator for local development only
origin group ID
workflow ID
VPC generation for candidate and draining services only
```

The workflow binding name is not durable identity.

Physical names use readable prefixes plus stable hashes. The developer discriminator is persisted in ignored local Vite state and included in the development provisioning-state key, so separate machines do not collide. Wrangler stores the association between each declaration and resolved resource IDs in its automatic provisioning state.

The provisioner verifies observed resource properties before reuse:

| Resource | Ownership evidence |
|---|---|
| Tunnel | Provisioning record, account, and deterministic name |
| VPC Service | Provisioning record, Tunnel ID, loopback host, and port |
| Relay Worker | Provisioning record, script name, and deployment metadata |
| Workflow registration | Provisioning record, relay script, class, and workflow ID |

A name-only match without ownership state is a conflict. Automatic adoption is not allowed.

Concurrent deploys use Wrangler's provisioning lock or fail before mutation when another deployment owns the environment lock.

## Development behavior

### `vite`

The Remote Workflows integration participates in the official Vite development lifecycle.

On startup it:

1. Resolves the development Worker name and environment.
2. Generates a local developer discriminator so two machines do not share one dev Tunnel accidentally.
3. Calls the Wrangler Remote Workflow provisioner for the developer-scoped graph.
4. Builds and starts the private-origin launcher.
5. Starts the Tunnel connector through Wrangler's Tunnel runner.
6. Starts the application Worker with remote Workflow bindings.
7. Probes the local origin protocol.
8. Probes the VPC Service WebSocket path.
9. Reports ready after both probes succeed.

The developer sees normal Vite output with an additional Remote Workflows status group.

The connector remains alive across origin hot restarts where possible. An origin restart invalidates active Cap'n Web sessions and is reported.

When Vite exits, the integration stops the connector and origin processes. It does not delete the developer-scoped Cloudflare graph on every shutdown.

### `vite preview`

Preview is side-effect-free. It does not provision resources or start a Tunnel. Remote Workflow bindings use an explicitly selected existing environment or fail with a clear unsupported-preview message.

## Tunnel connector behavior

### Development

Wrangler owns Tunnel authentication and connector startup. The Vite integration asks Wrangler to run the owned Tunnel and receives lifecycle events without handling the token directly.

Wrangler may download and manage `cloudflared` through its existing Tunnel command implementation.

The connector token never appears in:

- Vite config.
- Generated Wrangler config.
- Build output.
- Application Worker bindings.
- Relay Worker variables.
- Vite logs.

### Production

A production connector must run on a long-lived host that shares a network namespace with the loopback origin server.

`wrangler deploy` cannot start a connector on an ephemeral build machine and call the deployment healthy. It checks Tunnel connector health before exposing new application bindings when production policy requires a live origin.

For initial deployment, Wrangler first prepares the Tunnel, candidate VPC Service, relay names, and origin handoff. If no connector is healthy, deployment stops before relay or application upload and prints standard Wrangler instructions for the owned Tunnel:

```sh
wrangler tunnel run <tunnel-name>
```

The prepared output also identifies the generated origin artifact, candidate loopback port, manifest revision, and readiness command. The customer installs that artifact under the production process manager with `REMOTE_WORKFLOWS_PORT` set to the candidate port, then runs the Tunnel command on the same host or uses the dashboard-provided service installation command.

After the candidate origin and connector are healthy, rerunning `wrangler deploy` reuses the prepared resources, verifies the candidate revision, deploys relays, and uploads the application binding.

Future managed-origin integrations may automate this handoff for Kubernetes, ECS, or a VM service. They are outside the first Vite integration. Without one, production requires the normal Vite build, Wrangler deploy, process-manager installation, and Wrangler Tunnel operations. The plan does not claim that Worker upload alone creates the private compute host.

## Production origin readiness

The generated origin launcher exposes a local protocol readiness endpoint. Each relay Worker also exports a default fetch readiness handler that uses its bound VPC Service but has no public route.

Wrangler uploads the candidate relay as an undeployed Worker version and invokes that version through a remote preview session. This tests the candidate VPC binding and origin before the version can receive Workflow traffic. No Workflow registration is required for the probe.

Before application bindings become active, Wrangler verifies:

- The Tunnel has a healthy connector.
- The VPC Service can reach the origin.
- The origin reports the expected protocol version.
- The origin reports the expected manifest revision.
- Every declared workflow path exists.

A mismatch leaves the Cloudflare graph prepared but does not upload an application binding that targets an incompatible origin.

## Update behavior

### Workflow code

A workflow implementation change produces a new origin manifest revision. Wrangler prepares a candidate VPC Service generation on an alternate loopback port before relay cutover. The production process manager starts the candidate artifact on that port while the active origin continues serving the previous revision.

Wrangler verifies the candidate revision, deploys relays against the candidate VPC Service, then keeps the previous VPC Service and origin revision for a drain window. An unmanaged origin requires the customer to perform the candidate process-manager update between the first prepared deploy and the resumed deploy.

### Relay code and limits

Wrangler uploads a new version of the same stable relay Worker. Workflow registration and application binding identity remain stable.

### Origin port

A port change creates a new VPC Service generation. Relays switch after the new origin is healthy. The old VPC Service remains during a drain window and is retired later.

### Binding rename

Changing the binding while retaining the workflow ID updates only the application binding.

### Workflow ID change

Changing the workflow ID creates a new durable Workflow identity. Wrangler reports the prior workflow as retired and does not delete it automatically.

## Removal and deletion

Removing a declaration from Vite configuration removes the application binding on the next successful deploy and marks the corresponding graph retired.

It does not automatically delete:

- Workflow registrations.
- Durable Workflow instances.
- Relay Workers needed by retained registrations.
- Shared origin resources.

`wrangler delete` detects owned Remote Workflows resources and defaults to preserving them. `wrangler delete --delete-remote-workflows` prompts for a retention choice and state-loss confirmation before removing them.

Per-workflow removal is exposed through Wrangler's normal resource configuration and deletion APIs. It removes only that Workflow registration and relay. Shared Tunnel and VPC resources remain while another active or retained workflow references them.

Deleting the application Worker without the explicit flag does not delete durable Workflow state.

## Workers Builds

Workers Builds runs the standard project commands:

```sh
vite build
wrangler deploy
```

The build phase emits the Remote Workflows declarations. The deploy phase receives Cloudflare credentials and provisions the graph.

Workers Builds cannot host the production origin after the job exits. A healthy external connector and matching origin revision are required before the application Worker receives active bindings.

Preview branches default to no isolated Remote Workflow graph. Supported preview policies are:

- `disabled`, the default.
- `shared`, explicitly bound to an existing environment.
- `isolated`, only when a preview origin and connector integration exists.

## Security model

- The application Worker receives only native Workflow bindings.
- Relay Workers receive only the VPC Service binding and non-secret settings.
- The workflow server binds only to `127.0.0.1`.
- The connector and workflow server share a trusted network namespace.
- Cloudflare authenticates the Tunnel connector.
- Build jobs require no Cloudflare credentials.
- Deploy jobs receive the Cloudflare permissions needed for Workers, Workflows, VPC Services, Tunnels, and provisioning state.
- Connector tokens remain inside Wrangler and `cloudflared` lifecycle handling.
- Ownership conflicts fail instead of adopting existing resources by name.
- Destructive Workflow deletion is explicit.

## Additive Alchemy support

The current `/alchemy` export remains available and unchanged. Customers already using Alchemy may continue declaring the existing `RemoteWorkflow` construct.

The Vite and Wrangler path does not use Alchemy internally. It uses Wrangler's first-party provisioning system.

Shared runtime code remains common:

- Relay implementation.
- Node and Bun adapters.
- Protocol validation.
- Structural Workflow types.
- Limits and errors.

Customers choose either the Alchemy or Wrangler provisioning path for a graph. The two paths do not manage the same resources.

## Required workers-sdk changes

### Cloudflare Vite plugin

- Add the public `integrations` API.
- Resolve integration contributions before creating Vite environments.
- Allow integrations to add auxiliary Workers programmatically.
- Allow integrations to add generated deployment metadata.
- Expose development process lifecycle and cleanup hooks.
- Expose a public typed Wrangler service to integrations before Worker environments start.
- Let that service provision Remote Workflow declarations, return resolved bindings, run a Tunnel connector, and report readiness.
- Include integration-generated binding declarations in type generation.
- Add integration compatibility tests for framework plugin ordering.

### Wrangler configuration

- Add the generated `remote_workflows` declaration schema.
- Preserve the declaration through generated config redirection.
- Exclude connector credentials from serialized config.
- Generate native application Workflow bindings after provisioning.

### Wrangler provisioning

- Add Tunnel provisioning ownership.
- Add candidate and active VPC Service generation ownership.
- Add private auxiliary relay deployment.
- Add Workflow registration provisioning.
- Add environment locking and interrupted-deploy recovery.
- Add retired-resource reporting.
- Add explicit Workflow-aware deletion behavior.

### Wrangler Tunnel integration

- Expose connector lifecycle to the Vite development process.
- Start and stop `cloudflared` without revealing its token.
- Report connector health and readiness.
- Reuse the standard Wrangler authentication session.

## Testing strategy

### Runtime tests

- One factory result per admitted connection.
- One disposal per connection.
- Multi-workflow path isolation.
- Protocol validation before factory creation.
- Message, depth, bigint, operation, and session limits.
- Node and Bun launcher parity.

### Vite integration tests

- Integration contributions resolve before Worker environments.
- Application config patching.
- Generated auxiliary relay Workers.
- No hand-written Wrangler config.
- Generated origin artifact.
- Generated binding types.
- Binding and environment collision handling.
- Vite dev process startup and shutdown.
- Side-effect-free build and preview.
- Framework plugin ordering.

### Wrangler provisioning tests

- First deploy creates the complete graph.
- Second deploy reuses all stable resources.
- Partial failure resumes without duplication.
- Relay deploy precedes Workflow registration.
- Workflow registration precedes application binding upload.
- Missing connector stops deployment before relay and application upload.
- Origin revision mismatch stops deployment before relay and application upload.
- Prepared deployment resumes after candidate origin readiness.
- Blue-green origin revision cutover retains the previous VPC generation for draining.
- Binding rename preserves Workflow identity.
- Workflow ID change retires the prior graph.
- Removed declarations do not delete durable state.
- Explicit deletion preserves shared resources until unreferenced.
- Connector tokens never enter generated files or logs.

### Live Cloudflare tests

Before release, a real account test must prove:

1. Wrangler creates the Tunnel and VPC Service.
2. Vite starts the private origin and connector.
3. The VPC Service preserves the WebSocket upgrade.
4. The relay receives `response.webSocket`.
5. The native `WorkflowStep` crosses Cap'n Web.
6. `step.do` callbacks cross in both directions.
7. The application binding creates an instance.
8. Completed steps replay from Cloudflare state.
9. Sleep, retry, event wait, rollback, and disconnect behavior match the documentation.
10. Repeated deployment preserves durable Workflow identity.
11. Explicit deletion leaves no unintended resources.

## Implementation phases

### Phase 0: live transport proof

- Deploy the current Alchemy implementation to a test account.
- Run the loopback origin and connector.
- Verify VPC Service WebSockets and native capability forwarding.
- Record compatibility flags and failure behavior.
- Stop if the callback path does not work.

### Phase 1: Vite integration contract

- Add the first-party `integrations` API to the Cloudflare Vite plugin.
- Define contribution ordering and collision behavior.
- Add auxiliary Worker, artifact, development lifecycle, and deployment metadata contributions.
- Add workers-sdk integration fixtures.

### Phase 2: Remote Workflows declaration and launcher

- Add `defineRemoteWorkflow()` and payload extraction types.
- Add the `/vite` export.
- Define and validate `RemoteWorkflowsOptions`.
- Add a multi-workflow origin gateway.
- Generate Node and Bun origin artifacts.
- Generate typed application bindings.

### Phase 3: generated deployment configuration

- Add the `remote_workflows` Wrangler schema.
- Emit declarations through the Cloudflare Vite build.
- Preserve declarations through redirected generated config.
- Build private relay Workers as auxiliary Workers.
- Keep build and preview free of account mutation.

### Phase 4: Wrangler provisioning

- Implement Tunnel plus candidate and active VPC Service ownership.
- Deploy private relay Workers.
- Register Workflows.
- Resolve native application bindings.
- Add deployment ordering, locking, recovery, and retirement reporting.
- Add explicit deletion semantics.

### Phase 5: Vite development lifecycle

- Provision developer-scoped resources through Wrangler.
- Start the generated origin launcher.
- Start `cloudflared` through Wrangler.
- Add local and remote readiness probes.
- Handle origin restart and process cleanup.

### Phase 6: production readiness

- Add connector and origin revision health gates.
- Add prepared and resumed deployment behavior for unmanaged origins.
- Add blue-green candidate-port cutover and drain reporting.
- Add Workers Builds coverage.
- Document production origin installation.
- Add one sidecar example, preferably Kubernetes.
- Complete live replay and disconnect verification.

## Acceptance criteria

The Vite and Wrangler integration is ready when:

- A customer declares a remote workflow only in `vite.config.ts` and its workflow module.
- Local development runs through ordinary `vite`.
- Cloudflare build and deployment run through ordinary `vite build` and `wrangler deploy`.
- An unmanaged production origin uses its existing process manager and the standard `wrangler tunnel run` or dashboard service installation flow.
- No Remote Workflows CLI exists or is required.
- No customer-authored Alchemy stack is required.
- No hand-written Wrangler config is required for generated relays and bindings.
- `vite build` works without Cloudflare credentials or account mutation.
- `vite` starts the origin and connector and reports end-to-end readiness.
- `wrangler deploy` creates the complete Cloudflare graph in dependency order.
- Production deployment remains prepared until the candidate origin artifact and connector pass readiness checks.
- Repeated deployment creates no duplicate resources.
- Interrupted deployment resumes safely.
- Several workflows share one Tunnel, connector, VPC Service, and origin process.
- Application bindings are typed from workflow entrypoints.
- Production application upload is blocked when the connector or origin revision is unavailable.
- Connector tokens never appear in build output, generated config, Worker bindings, or logs.
- Removing a declaration does not delete durable Workflow state.
- Existing runtime and `/alchemy` APIs continue to work.
- Live tests prove VPC WebSockets, native step forwarding, callbacks, replay, and disconnect behavior.

## Open questions

1. What exact integration contribution API best fits the Cloudflare Vite plugin's environment resolution lifecycle?
2. Should the Remote Workflows declaration live only in Vite integration metadata or become a general Wrangler configuration feature?
3. Where should Wrangler persist ownership for the multi-resource graph?
4. Which account metadata or tags can prove ownership without name-based adoption?
5. Can the existing Wrangler Tunnel runner expose a process lifecycle API to Vite, or should Vite call a new dedicated Wrangler service?
6. How should production connector installation consume the Tunnel token without exposing a broad Cloudflare API credential on the origin host?
7. Which Workflow instance states and retention checks are available before explicit registration deletion?
8. Should one relay Worker host several Workflow registrations after the one-relay-per-workflow implementation is proven?
9. Which preview policy should frameworks use by default when no preview origin exists?
10. When can the Build Output configuration represent integration-contributed auxiliary Workers and Remote Workflow declarations directly?

## Risks

### First-party surface area

The clean DX requires coordinated changes across the Cloudflare Vite plugin, generated configuration, Wrangler provisioning, and Tunnel lifecycle. A package-only sibling Vite plugin cannot provide the same result safely.

### Unproven transport

The product still depends on VPC Service WebSockets preserving bidirectional Cap'n Web and Workers RPC capabilities. Phase 0 remains the first gate.

### Production origin gap

Worker deployment cannot create a long-lived process on an arbitrary customer host. Wrangler must distinguish prepared Cloudflare infrastructure from an active deployment with a healthy origin.

### Durable identity loss

Worker, environment, or workflow identity mistakes can duplicate or orphan durable Workflow registrations. Provisioning state and explicit workflow IDs are required.

### Hidden destructive behavior

Automatic provisioning must not imply automatic durable-state deletion. Retirement and explicit deletion need separate behavior.

### Connector credential exposure

The Tunnel runner must keep connector tokens out of generated files, logs, and Worker configuration.

### Evolving APIs

Vite integrations, auxiliary Workers, generated config, Wrangler automatic provisioning, Tunnel commands, and Workers VPC are evolving. The implementation must land with compatibility tests across the supported workers-sdk release range.

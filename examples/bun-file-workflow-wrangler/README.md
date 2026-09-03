# Bun file workflow with Wrangler

This example deploys a remote file-writing workflow with Wrangler instead of Alchemy. The Worker exports a named `WorkerEntrypoint` and binds back to it through a Service binding. The durable step asks that binding for the output filename, then writes the payload's `contents` to that file on the machine running Bun.

The relevant files are:

- `src/workflow.ts` declares the workflow implementation and uses the forwarded Service binding.
- `src/server.ts` runs the implementation on loopback with the Bun adapter.
- `src/relay.ts` exports the relay Workflow, the bound `WorkerEntrypoint`, and the Worker's top-level fetch handler.
- `service-binding/index.ts` defines the bound `WorkerEntrypoint`.
- `wrangler.jsonc` configures the private Worker, self Service binding, and named Workflow.

Build the library and check the example from the repository root:

```sh
pnpm build
pnpm --filter=remote-workflows-wrangler-bun-file-example check
```

## Authenticate

Wrangler's Tunnel commands currently require an API token with Cloudflare Tunnel write access. The account also needs permission to administer Connectivity Directory resources and deploy Workers. This example pins Wrangler 4.128.0 because its Tunnel commands are experimental.

```sh
export CLOUDFLARE_API_TOKEN="..."
```

If the token can access more than one account, select one explicitly:

```sh
export CLOUDFLARE_ACCOUNT_ID="..."
```

Run the remaining commands from the example directory:

```sh
cd examples/bun-file-workflow-wrangler
```

## Create the Tunnel and VPC Service

Create a remotely managed Tunnel:

```sh
pnpm exec wrangler tunnel create remote-workflows-wrangler-bun-file-relay-tunnel
```

Copy the Tunnel UUID from the command output and keep it for the next command and cleanup:

```sh
export TUNNEL_ID="<TUNNEL_ID>"
```

Create a VPC Service that connects the relay to the Bun server on loopback:

```sh
pnpm exec wrangler vpc service create \
  remote-workflows-wrangler-bun-file-relay-server \
  --type http \
  --tunnel-id "$TUNNEL_ID" \
  --ipv4 127.0.0.1 \
  --http-port 8789
```

Copy the VPC Service UUID from the output:

```sh
export VPC_SERVICE_ID="<VPC_SERVICE_ID>"
```

Replace `<VPC_SERVICE_ID>` in `wrangler.jsonc` with that UUID.

## Deploy

Deploy the Worker:

```sh
pnpm exec wrangler deploy --config wrangler.jsonc
```

The bundle contains the default fetch handler, the named `RemoteWorkflow` export, and the named `ServiceBinding` export. Wrangler binds `SERVICE_BINDING` back to the `ServiceBinding` entrypoint on the same Worker. The Worker has no route, workers.dev hostname, or preview URL. The deployment also creates the `WranglerBunFileWorkflow` Workflow.

## Run and trigger the workflow

Run the workflow origin and Tunnel connector in separate terminals:

```sh
pnpm serve
```

```sh
pnpm exec wrangler tunnel run remote-workflows-wrangler-bun-file-relay-tunnel
```

Trigger an instance from a third terminal:

```sh
pnpm exec wrangler workflows trigger WranglerBunFileWorkflow \
  '{"contents":"written through Wrangler\n"}' \
  --config wrangler.jsonc
```

The completed step creates `workflow-output.txt` in this directory. There is no API Worker in this example. Wrangler's Workflow command creates the instance directly.

## Clean up

Stop the connector. Then remove the Workflow and Worker before deleting their VPC Service and Tunnel dependencies:

```sh
pnpm exec wrangler workflows delete WranglerBunFileWorkflow --config wrangler.jsonc
pnpm exec wrangler delete remote-workflows-wrangler-bun-file-relay --force
pnpm exec wrangler vpc service delete "$VPC_SERVICE_ID"
pnpm exec wrangler tunnel delete "$TUNNEL_ID" --force
```

Deleting the Workflow also deletes its instances.

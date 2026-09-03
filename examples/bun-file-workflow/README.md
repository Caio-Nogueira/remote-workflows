# Bun file workflow

This example has one workflow and one durable step. The step writes the payload's `contents` to `workflow-output.txt` on the machine running Bun.

The relevant files are:

- `src/workflow.ts` declares the workflow implementation.
- `src/server.ts` wraps the class with the Bun adapter and listens on loopback.
- `alchemy.run.ts` wraps the same origin with the Alchemy construct and names the deployed Workflow.
- `remote-workflows-connect` comes from the library package and starts the Tunnel connector from Alchemy's stored state.

Build the library and check the example from the repository root:

```sh
pnpm build
pnpm --filter=remote-workflows-bun-file-example check
```

When you are ready to deploy the Cloudflare resources, run:

```sh
cd examples/bun-file-workflow
pnpm run deploy
```

That command deploys the Tunnel, loopback VPC Service, private relay Worker, and a Workflow named `BunFileWorkflow`. It does not run the Bun process or the Tunnel connector.

If this example was deployed before `workflowName` was configured, the next deployment creates the configured Workflow identity and detaches the generated registration from the relay. The old account-global Workflow may remain and needs explicit cleanup after its instances are no longer needed.

Run the workflow origin and Tunnel connector in separate terminals:

```sh
pnpm run serve
```

```sh
pnpm run connect
```

`connect` calls the library's `remote-workflows-connect` executable. It reads the connector token from the `WriteFileTunnel` Alchemy resource without printing it. If the stack has more than one deployed stage, select one explicitly:

```sh
ALCHEMY_STAGE=staging pnpm run connect
```

There is intentionally no API Worker in this example. Something else must bind to the deployed Workflow before it can create an instance.

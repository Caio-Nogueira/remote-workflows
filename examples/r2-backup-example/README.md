# Vaultwarden backup workflow with Wrangler

This example replaces the Raspberry Pi's `vaultwarden-backup.timer` with a scheduled Cloudflare Workflow. Cloudflare owns the six-hour schedule and durable step state; the backup implementation still runs privately on the Pi through a Tunnel and loopback VPC Service.

Each Workflow instance:

1. Runs the Vaultwarden CLI backup, validates the SQLite snapshot, creates `vaultwarden-backup.zip`, and validates the ZIP.
2. Uploads the archive to `vaultwarden-backup/vaultwarden-backup.zip` through the Worker's `VAULTWARDEN_BACKUPS` R2 binding, with R2 enforcing the local SHA-256 checksum.
3. Removes the generated SQLite snapshot after a successful upload while retaining the local ZIP, matching the existing backup script.

The Workflow's named steps and results are visible in the Cloudflare Workflows dashboard. The Worker has no public route, workers.dev hostname, or preview URL.

## Size constraint

The current archive on the Pi is about 25 KB. This implementation buffers it because Workers RPC has a 32 MiB maximum serialized message size. It rejects archives larger than 31 MiB to leave room for RPC framing and metadata. R2 itself accepts single-part uploads up to 5 GiB, but this example must switch the upload argument to a byte-oriented `ReadableStream` before removing the 31 MiB guard.

## Build and check

Use pnpm 10.15.1, Node.js 22 or newer, and Bun. From the repository root:

```sh
pnpm install
pnpm build
pnpm --filter=remote-workflows-r2-backup-example types
pnpm --filter=remote-workflows-r2-backup-example check
```

`wrangler types` generates `worker-configuration.d.ts` from `wrangler.jsonc`. The source uses its global `Env` interface instead of maintaining binding types by hand. Regenerate the file after changing any binding, variable, or Workflow registration; `pnpm check` fails when it is stale.

## Authenticate

Wrangler's Tunnel commands currently require an API token with Cloudflare Tunnel write access. The account also needs permission to administer Connectivity Directory resources, deploy Workers and Workflows, and bind the existing `vaultwarden-backup` R2 bucket. This example pins Wrangler 4.128.0 because its Tunnel commands are experimental.

```sh
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="..."
```

Run the remaining commands from this directory:

```sh
cd examples/r2-backup-example
```

## Create the Tunnel and VPC Service

Create a remotely managed Tunnel:

```sh
pnpm exec wrangler tunnel create vaultwarden-backup-relay-tunnel
```

Copy the Tunnel UUID from the command output:

```sh
export TUNNEL_ID="<TUNNEL_ID>"
```

Create a VPC Service that connects the relay to the Bun server on loopback:

```sh
pnpm exec wrangler vpc service create \
  vaultwarden-backup-relay-server \
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

## Deploy the Cloudflare resources

```sh
pnpm exec wrangler deploy --config wrangler.jsonc
```

The deployment creates the private `vaultwarden-backup-relay` Worker and the `VaultwardenBackupWorkflow` Workflow. The Workflow binding's `0 */6 * * *` schedule starts a new instance every six hours at 00:00, 06:00, 12:00, and 18:00 UTC.

## Run the private origin

The origin and Tunnel connector must run on the Vaultwarden host in the same network namespace. The origin process must run as a user that can access `/var/lib/vaultwarden`, read `/etc/vaultwarden.env`, and execute `/opt/vaultwarden/output/vaultwarden`.

For an interactive deployment check, start them in separate terminals:

```sh
pnpm serve
```

```sh
pnpm exec wrangler tunnel run vaultwarden-backup-relay-tunnel
```

For normal operation, use the host's process supervisor to keep both commands running across failures and reboots. Store the Tunnel token in the supervisor's credential or secret mechanism rather than in the repository, environment files committed to source control, or command-line arguments.

When migrating from another scheduler, keep the previous schedule active until a manually triggered Workflow has completed and the R2 object has been verified. Disable the previous schedule only as the final cutover step.

## Trigger a deployment check

```sh
pnpm exec wrangler workflows trigger VaultwardenBackupWorkflow \
  '{}' \
  --config wrangler.jsonc
```

Confirm that the Workflow completes, its upload step reports the expected byte count and checksum, and `vaultwarden-backup/vaultwarden-backup.zip` has been updated before disabling any legacy scheduler.

## Clean up Cloudflare resources

Stop the connector, then remove the Workflow and Worker before deleting their VPC Service and Tunnel dependencies:

```sh
pnpm exec wrangler workflows delete VaultwardenBackupWorkflow --config wrangler.jsonc
pnpm exec wrangler delete vaultwarden-backup-relay --force
pnpm exec wrangler vpc service delete "$VPC_SERVICE_ID"
pnpm exec wrangler tunnel delete "$TUNNEL_ID" --force
```

Deleting the Workflow also deletes its instances.

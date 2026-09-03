import { readdir, rename, rm } from "node:fs/promises";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

const VAULTWARDEN_CLI = "/opt/vaultwarden/output/vaultwarden";
const BACKUP_DIRECTORY = "/var/lib/vaultwarden";
const VAULTWARDEN_ENV_FILE = "/etc/vaultwarden.env";
const ARCHIVE_NAME = "vaultwarden-backup.zip";
const ARCHIVE_PATH = `${BACKUP_DIRECTORY}/${ARCHIVE_NAME}`;
const SNAPSHOT_PATTERN = /^db_[0-9].*\.sqlite3$/;

// Workers RPC has a 32 MiB serialized-message limit. Keep one MiB for RPC
// framing and upload metadata; switch this step to a byte stream before raising
// the limit.
const MAX_BUFFERED_BACKUP_BYTES = 31 * 1024 * 1024;

interface PreparedBackup {
  archivePath: string;
  bytes: number;
  sha256: string;
  snapshotPath: string;
}

export interface VaultwardenBackupResult {
  bytes: number;
  etag: string;
  objectKey: string;
  sha256: string;
}

async function run(command: string[], cwd = BACKUP_DIRECTORY): Promise<void> {
  const process = Bun.spawn(command, {
    cwd,
    env: {
      ...Bun.env,
      ENV_FILE: VAULTWARDEN_ENV_FILE,
      HOME: BACKUP_DIRECTORY,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, , stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  if (exitCode !== 0) {
    const detail = stderr.trim();
    throw new Error(
      `${command[0]} exited with status ${exitCode}${detail ? `: ${detail}` : ""}`,
    );
  }
}

async function findSnapshots(): Promise<string[]> {
  return (await readdir(BACKUP_DIRECTORY))
    .filter((name) => SNAPSHOT_PATTERN.test(name))
    .map((name) => `${BACKUP_DIRECTORY}/${name}`);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function prepareBackup(): Promise<PreparedBackup> {
  for (const staleSnapshot of await findSnapshots()) {
    await rm(staleSnapshot, { force: true });
  }

  await run([VAULTWARDEN_CLI, "backup"]);

  const snapshots = await findSnapshots();
  if (snapshots.length !== 1) {
    throw new Error(
      `Expected exactly one fresh database snapshot, found ${snapshots.length}.`,
    );
  }
  const snapshotPath = snapshots[0];
  if (snapshotPath === undefined) {
    throw new Error("Vaultwarden did not create a database snapshot.");
  }

  const integrityCheck = Bun.spawnSync([
    "sqlite3",
    snapshotPath,
    "PRAGMA quick_check;",
  ]);
  if (
    integrityCheck.exitCode !== 0 ||
    integrityCheck.stdout.toString().trim() !== "ok"
  ) {
    throw new Error("SQLite integrity check failed.");
  }

  const temporaryArchive = `${BACKUP_DIRECTORY}/vaultwarden-backup.${crypto.randomUUID()}.zip`;
  try {
    await run(["zip", "-q", "-j", temporaryArchive, snapshotPath]);
    await run(["unzip", "-tq", temporaryArchive]);
    await rename(temporaryArchive, ARCHIVE_PATH);
  } catch (error) {
    await rm(temporaryArchive, { force: true });
    throw error;
  }

  const bytes = await Bun.file(ARCHIVE_PATH).arrayBuffer();
  if (bytes.byteLength > MAX_BUFFERED_BACKUP_BYTES) {
    throw new Error(
      `Backup archive is ${bytes.byteLength} bytes; the buffered RPC limit is ${MAX_BUFFERED_BACKUP_BYTES} bytes.`,
    );
  }

  return {
    archivePath: ARCHIVE_PATH,
    bytes: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    snapshotPath,
  };
}

export class VaultwardenBackupWorkflow {
  declare readonly env: Env;

  async run(
    _event: Readonly<WorkflowEvent<unknown>>,
    step: WorkflowStep,
  ): Promise<VaultwardenBackupResult> {
    const prepared = await step.do("prepare and validate backup", prepareBackup);

    const uploaded = await step.do("upload backup to R2", async () => {
      const bytes = await Bun.file(prepared.archivePath).arrayBuffer();
      if (bytes.byteLength !== prepared.bytes) {
        throw new Error("Backup archive changed after it was prepared.");
      }

      const object = await this.env.VAULTWARDEN_BACKUPS.put(
        ARCHIVE_NAME,
        bytes,
        {
          httpMetadata: { contentType: "application/zip" },
          sha256: prepared.sha256,
        },
      );
      if (object === null) {
        throw new Error("R2 rejected the backup upload.");
      }

      const [etag, size] = await Promise.all([object.etag, object.size]);
      if (size !== prepared.bytes) {
        throw new Error(
          `R2 reported ${size} uploaded bytes; expected ${prepared.bytes}.`,
        );
      }

      return { etag, size };
    });

    await step.do("remove local database snapshot", async () => {
      await rm(prepared.snapshotPath, { force: true });
    });

    return {
      bytes: uploaded.size,
      etag: uploaded.etag,
      objectKey: ARCHIVE_NAME,
      sha256: prepared.sha256,
    };
  }
}

export const REMOTE_WORKFLOW_PROTOCOL_VERSION = "1";
export const REMOTE_WORKFLOW_PROTOCOL_HEADER = "x-remote-workflow-protocol";

export interface RemoteWorkflowUpgradeRequest {
  headers: Headers;
  method: string;
}

export type UpgradeValidationResult =
  | { ok: true }
  | {
      ok: false;
      status: 405 | 426;
      headers?: Record<string, string>;
    };

export function validateUpgrade(
  request: Readonly<RemoteWorkflowUpgradeRequest>,
): UpgradeValidationResult {
  if (request.method !== "GET") {
    return { ok: false, status: 405 };
  }

  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return { ok: false, status: 426, headers: { Upgrade: "websocket" } };
  }

  if (
    request.headers.get(REMOTE_WORKFLOW_PROTOCOL_HEADER) !==
    REMOTE_WORKFLOW_PROTOCOL_VERSION
  ) {
    return {
      ok: false,
      status: 426,
      headers: {
        [REMOTE_WORKFLOW_PROTOCOL_HEADER]: REMOTE_WORKFLOW_PROTOCOL_VERSION,
      },
    };
  }

  return { ok: true };
}

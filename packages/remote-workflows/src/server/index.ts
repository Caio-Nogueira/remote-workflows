export {
  REMOTE_WORKFLOW_PROTOCOL_HEADER,
  REMOTE_WORKFLOW_PROTOCOL_VERSION,
  validateUpgrade,
  type RemoteWorkflowUpgradeRequest,
  type UpgradeValidationResult,
} from "./protocol.js";
export {
  createWorkflowTarget,
  WorkflowRpcTarget,
  type RemoteWorkflowClass,
  type RemoteWorkflowTarget,
} from "./target.js";

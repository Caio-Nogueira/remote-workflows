import { RpcTarget } from "capnweb";
import {
  workflowEventSchema,
  workflowImplementationSchema,
  workflowStepSchema,
} from "../schemas.js";

interface RemoteWorkflowImplementation {
  run: (...args: never[]) => unknown;
}

export interface RemoteWorkflowClass {
  new (): RemoteWorkflowImplementation;
}

export interface RemoteWorkflowTarget extends RpcTarget {
  run(event: unknown, step: unknown): Promise<unknown>;
}

export class WorkflowRpcTarget extends RpcTarget {
  readonly #workflow: RemoteWorkflowImplementation;

  constructor(workflow: RemoteWorkflowImplementation) {
    super();
    this.#workflow = workflow;
  }

  async run(event: unknown, step: unknown): Promise<unknown> {
    workflowEventSchema.parse(event);
    workflowStepSchema.parse(step);
    const result: unknown = Reflect.apply(
      this.#workflow.run,
      this.#workflow,
      [event, step],
    );
    return await result;
  }
}

export function createWorkflowTarget(
  Workflow: RemoteWorkflowClass,
): WorkflowRpcTarget {
  const workflow = new Workflow();
  workflowImplementationSchema.parse(workflow);
  return new WorkflowRpcTarget(workflow);
}

import { RpcTarget } from "capnweb";
import {
  workflowEnvironmentSchema,
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

export type RemoteWorkflowEnvironment = Readonly<Record<string, unknown>>;

export interface RemoteWorkflowTarget extends RpcTarget {
  run(
    event: unknown,
    step: unknown,
    env: RemoteWorkflowEnvironment,
  ): Promise<unknown>;
}

export class WorkflowRpcTarget extends RpcTarget {
  readonly #workflow: RemoteWorkflowImplementation;
  #started = false;

  constructor(workflow: RemoteWorkflowImplementation) {
    super();
    this.#workflow = workflow;
  }

  async run(
    event: unknown,
    step: unknown,
    env: unknown,
  ): Promise<unknown> {
    workflowEventSchema.parse(event);
    workflowStepSchema.parse(step);
    const workflowEnvironment = workflowEnvironmentSchema.parse(env);
    if (this.#started) {
      throw new Error("A workflow RPC target can only run once.");
    }
    this.#started = true;
    Object.defineProperty(this.#workflow, "env", {
      configurable: false,
      enumerable: false,
      value: workflowEnvironment,
      writable: false,
    });

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

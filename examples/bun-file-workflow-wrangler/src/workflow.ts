import { fileURLToPath } from "node:url";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env } from "./relay.ts";

export interface WriteFilePayload {
  contents: string;
}

export interface WriteFileResult {
  bytesWritten: number;
  path: string;
}

export class WriteFileWorkflow {
  declare readonly env: Env;

  async run(
    event: Readonly<WorkflowEvent<WriteFilePayload>>,
    step: WorkflowStep,
  ): Promise<WriteFileResult> {
    return await step.do("write local file", async () => {
      const fileName = await this.env.SERVICE_BINDING.getOutputFileName();
      const path = fileURLToPath(new URL(`../${fileName}`, import.meta.url));
      const bytesWritten = await Bun.write(path, event.payload.contents);

      return { bytesWritten, path };
    });
  }
}

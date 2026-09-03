import { fileURLToPath } from "node:url";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

export interface WriteFilePayload {
  contents: string;
}

export interface WriteFileResult {
  bytesWritten: number;
  path: string;
}

export class WriteFileWorkflow {
  async run(
    event: Readonly<WorkflowEvent<WriteFilePayload>>,
    step: WorkflowStep,
  ): Promise<WriteFileResult> {
    return await step.do("write local file", async () => {
      const path = fileURLToPath(
        new URL("../workflow-output.txt", import.meta.url),
      );
      const bytesWritten = await Bun.write(path, event.payload.contents);

      return { bytesWritten, path };
    });
  }
}

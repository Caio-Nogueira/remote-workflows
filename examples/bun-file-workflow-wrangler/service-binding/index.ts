import { WorkerEntrypoint } from "cloudflare:workers";

export class ServiceBinding extends WorkerEntrypoint {
  override fetch(): Response {
    return new Response(this.getOutputFileName());
  }

  getOutputFileName(): string {
    return "workflow-output.txt";
  }
}

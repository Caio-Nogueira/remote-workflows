export { RemoteWorkflow } from "@cloudflare/remote-workflows/worker";
export { ServiceBinding } from "../service-binding/index.ts";

export interface Env {
  REMOTE_WORKFLOW_SERVER: Fetcher;
  REMOTE_WORKFLOW_PATH: "/write-file";
  SERVICE_BINDING: Service<
    typeof import("../service-binding/index.ts").ServiceBinding
  >;
  REMOTE_WORKFLOW_REGISTRATION: Workflow;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.SERVICE_BINDING.fetch(request);
  },
} satisfies ExportedHandler<Env>;

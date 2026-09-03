export { RemoteWorkflow } from "@cloudflare/remote-workflows/worker";

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

import { RemoteWorkflow } from "@cloudflare/remote-workflows/alchemy";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import type { WriteFilePayload } from "./src/workflow.ts";

export default Alchemy.Stack(
  "BunFileWorkflow",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const workflow = yield* RemoteWorkflow<WriteFilePayload>("WriteFile", {
      origin: {
        path: "/write-file",
        port: 8789,
      },
      workflowName: "BunFileWorkflow",
    });

    return {
      connectorToken: workflow.tunnel.token,
      server: workflow.server,
      tunnelId: workflow.tunnel.id,
      workflowName: workflow.workflowName,
    };
  }),
);

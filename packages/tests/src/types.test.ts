import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { describe, expectTypeOf, it } from "vitest";
import type { ServeWorkflowOptions as BunServeWorkflowOptions } from "@cloudflare/remote-workflows/bun";
import type { ServeWorkflowOptions as NodeServeWorkflowOptions } from "@cloudflare/remote-workflows/node";
import type { RemoteWorkflowClass } from "@cloudflare/remote-workflows/server";

describe("public workflow types", () => {
  it("accepts a workflow class using official Cloudflare types", () => {
    class OrdersWorkflow {
      async run(
        event: Readonly<WorkflowEvent<{ orderId: string }>>,
        step: WorkflowStep,
      ): Promise<string> {
        await step.sleep("brief pause", "1 second");
        await step.sleepUntil("deadline", Date.now() + 1_000);
        const approval = await step.waitForEvent<{ approved: boolean }>(
          "approval",
          { type: "approval", timeout: "1 day" },
        );
        return await step.do(
          "process",
          { retries: { limit: 3, delay: "1 second" } },
          async () =>
            `${event.payload.orderId}:${approval.payload.approved}`,
        );
      }
    }

    expectTypeOf<typeof OrdersWorkflow>().toMatchTypeOf<RemoteWorkflowClass>();
    expectTypeOf<BunServeWorkflowOptions["workflow"]>().toEqualTypeOf<
      RemoteWorkflowClass
    >();
    expectTypeOf<NodeServeWorkflowOptions["workflow"]>().toEqualTypeOf<
      RemoteWorkflowClass
    >();
  });
});

import "zod/compile";
import * as z from "zod";

function isAbsolutePath(value: string): boolean {
  const parsed = new URL(value, "http://remote-workflow");
  return (
    parsed.pathname === value &&
    parsed.search === "" &&
    parsed.hash === ""
  );
}

export const workflowPathSchema = z
  .templateLiteral(["/", z.string()])
  .refine(isAbsolutePath, "Expected an absolute URL path");

export const workflowServerOptionsSchema = z.object({
  path: workflowPathSchema.default("/rpc"),
  port: z.int().min(0).max(65_535),
});

export const workflowNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/u);

export const remoteWorkflowPropsSchema = z.object({
  adopt: z.boolean().optional(),
  env: z.record(z.string(), z.unknown()).default({}),
  origin: z.object({
    path: workflowPathSchema,
    port: z.int().min(1).max(65_535),
  }),
  workflowName: workflowNameSchema.optional(),
});

export type RemoteWorkflowProps = z.input<typeof remoteWorkflowPropsSchema>;

export const workflowEventSchema = z.object({
  instanceId: z.string().min(1),
  payload: z.unknown(),
  schedule: z
    .object({
      cron: z.string(),
      scheduledTime: z.number().finite(),
    })
    .optional(),
  timestamp: z.date(),
  workflowName: z.string().min(1),
});

export const workflowEnvironmentSchema = z.custom<Record<string, unknown>>(
  (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  },
  "Expected a remote workflow environment",
);

export const workflowStepSchema = z.custom(
  (value) =>
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    ["do", "sleep", "sleepUntil", "waitForEvent"].every(
      (method) =>
        typeof (value as Record<string, unknown>)[method] === "function",
    ),
  "Expected a WorkflowStep RPC capability",
);

export const workflowImplementationSchema = z.object({
  run: z.function(),
});

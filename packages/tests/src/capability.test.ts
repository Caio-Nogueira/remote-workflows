import { RpcStub, RpcTarget } from "capnweb";
import { describe, expect, it } from "vitest";
import {
  createRemoteWorkflowEnvironment,
} from "../../remote-workflows/src/worker/environment.js";

interface ResultCapability extends RpcTarget {
  readonly value: number;
}

interface CounterCapability extends RpcTarget {
  add(amount: number): Promise<ResultCapability>;
  apply(callback: (value: number) => number): Promise<number>;
}

interface HelperCapability {
  factor: number;
  multiply(value: number): number;
}

class CounterResult {
  constructor(readonly value: number) {}
}

class CounterBinding {
  #value = 1;

  async add(amount: number): Promise<CounterResult> {
    this.#value += amount;
    return new CounterResult(this.#value);
  }

  async apply(callback: (value: number) => number): Promise<number> {
    await Promise.resolve();
    return await callback(this.#value);
  }
}

describe("remote workflow environment", () => {
  it("wraps binding methods and returned host objects as capabilities", async () => {
    const env = createRemoteWorkflowEnvironment({
      COUNTER: new CounterBinding(),
      HELPER: {
        factor: 2,
        multiply(this: HelperCapability, value: number) {
          return this.factor * value;
        },
      },
      NAME: "test",
      REMOTE_WORKFLOW_PATH: "/rpc",
    });

    expect(env.NAME).toBe("test");
    expect(env.REMOTE_WORKFLOW_PATH).toBe("/rpc");

    const target = env.COUNTER;
    expect(target).toBeInstanceOf(RpcTarget);
    const counter = new RpcStub(target as CounterCapability);
    const helper = new RpcStub(env.HELPER as HelperCapability);
    const result = counter.add(2);

    await expect(result.value).resolves.toBe(3);
    await expect(counter.apply((value) => value * 2)).resolves.toBe(6);
    await expect(helper.multiply(3)).resolves.toBe(6);

    result[Symbol.dispose]();
    helper[Symbol.dispose]();
    counter[Symbol.dispose]();
  });
});

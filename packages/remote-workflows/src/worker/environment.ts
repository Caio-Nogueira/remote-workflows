import { RpcPromise, RpcTarget } from "capnweb";

class DynamicRpcTarget extends RpcTarget {}

type Capability = RpcTarget | ((...args: unknown[]) => unknown);

const reservedProperties = new Set([
  "catch",
  "dup",
  "finally",
  "map",
  "onRpcBroken",
  "then",
]);

function isPassByValue(value: object): boolean {
  return (
    value instanceof Date ||
    value instanceof Error ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    (typeof Headers !== "undefined" && value instanceof Headers) ||
    (typeof ReadableStream !== "undefined" &&
      value instanceof ReadableStream) ||
    (typeof Request !== "undefined" && value instanceof Request) ||
    (typeof Response !== "undefined" && value instanceof Response) ||
    (typeof URL !== "undefined" && value instanceof URL) ||
    (typeof WritableStream !== "undefined" &&
      value instanceof WritableStream)
  );
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

export function createRemoteWorkflowEnvironment(
  env: object,
): Record<string, unknown> {
  const capabilities = new WeakMap<object, Capability>();
  const activeValues = new WeakSet<object>();

  const wrap = (value: unknown, owner?: object): unknown => {
    if (
      value === null ||
      (typeof value !== "object" && typeof value !== "function")
    ) {
      return value;
    }
    if (value instanceof RpcTarget || isPassByValue(value)) {
      return value;
    }
    if (value instanceof Promise) {
      return new RpcPromise(
        value.then((resolved) => wrap(resolved) as never),
      );
    }
    if (Array.isArray(value)) {
      if (activeValues.has(value)) {
        return wrapCapability(value);
      }
      activeValues.add(value);
      const result = value.map((item) => wrap(item));
      activeValues.delete(value);
      return result;
    }
    if (isPlainObject(value)) {
      if (activeValues.has(value)) {
        return wrapCapability(value);
      }
      activeValues.add(value);
      const result = Object.fromEntries(
        Object.entries(value).map(([name, item]) => [
          name,
          wrap(item, value),
        ]),
      );
      activeValues.delete(value);
      return result;
    }
    return wrapCapability(
      value,
      typeof value === "function" ? owner : undefined,
    );
  };

  const wrapCapability = (
    value: object,
    owner?: object,
  ): Capability => {
    const existing = owner === undefined ? capabilities.get(value) : undefined;
    if (existing !== undefined) {
      return existing;
    }

    if (typeof value === "function") {
      const capability = (...args: unknown[]) =>
        Promise.resolve(Reflect.apply(value, owner, args)).then(wrap);
      if (owner === undefined) {
        capabilities.set(value, capability);
      }
      return capability;
    }

    const target = new DynamicRpcTarget();
    const capability = new Proxy(target, {
      get(target, property, receiver) {
        if (
          typeof property !== "string" ||
          reservedProperties.has(property)
        ) {
          return Reflect.get(target, property, receiver);
        }

        const member: unknown = Reflect.get(value, property, value);
        if (typeof member === "function") {
          return (...args: unknown[]) =>
            Promise.resolve(Reflect.apply(member, value, args)).then(wrap);
        }
        return wrap(member);
      },
    });
    capabilities.set(value, capability);
    return capability;
  };

  return Object.fromEntries(
    Object.entries(env).map(([name, value]) => [name, wrap(value)]),
  );
}

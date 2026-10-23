import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../src/lib/api";
import { recoverMutationOutcome } from "../src/lib/mutation-recovery";

describe("critical mutation recovery", () => {
  it("does not reconcile a confirmed client error", async () => {
    const load = vi.fn(async () => ({ status: "OFFER" }));
    const error = new ApiRequestError("Недопустимый переход", "confirmed", 409);

    const result = await recoverMutationOutcome(error, load, () => false);

    expect(result.status).toBe("confirmed-error");
    expect(load).not.toHaveBeenCalled();
  });

  it("performs one GET after an unknown outcome and recognizes an applied command", async () => {
    const load = vi.fn(async () => ({ status: "SIGNING" }));
    const error = new ApiRequestError("Сеть недоступна", "unknown");

    const result = await recoverMutationOutcome(error, load, (state) => state.status === "SIGNING");

    expect(result).toEqual({ status: "applied", value: { status: "SIGNING" } });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("allows a user-driven retry when GET confirms the baseline state", async () => {
    const load = vi.fn(async () => ({ status: "OFFER" }));
    const error = new ApiRequestError("Timeout", "unknown");

    const result = await recoverMutationOutcome(error, load, (state) => state.status === "SIGNING");

    expect(result).toEqual({ status: "retry", value: { status: "OFFER" } });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps the result unresolved when reconciliation GET fails", async () => {
    const load = vi.fn(async () => {
      throw new ApiRequestError("GET failed", "unknown");
    });
    const error = new ApiRequestError("POST failed", "unknown");

    const result = await recoverMutationOutcome(error, load, () => false);

    expect(result.status).toBe("unresolved");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never invokes the original POST during recovery", async () => {
    const mutate = vi.fn(async () => ({ ok: true }));
    const load = vi.fn(async () => ({ status: "OFFER" }));
    const error = new ApiRequestError("Connection reset after send", "unknown");

    await recoverMutationOutcome(error, load, () => false);

    expect(mutate).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

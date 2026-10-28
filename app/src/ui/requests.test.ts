import { describe, expect, it } from "vitest";
import { createRequestGate } from "./requests";

describe("createRequestGate", () => {
  it("新的提問開始時，舊的提問失效並取消連線", () => {
    const gate = createRequestGate();
    const first = gate.begin();
    expect(first.isCurrent()).toBe(true);
    const second = gate.begin();
    expect(first.isCurrent()).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it("cancel（切換身分或語言）後，進行中的提問失效並取消連線", () => {
    const gate = createRequestGate();
    const ticket = gate.begin();
    gate.cancel();
    expect(ticket.isCurrent()).toBe(false);
    expect(ticket.signal.aborted).toBe(true);
    expect(gate.begin().isCurrent()).toBe(true);
  });
});

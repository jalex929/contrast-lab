import { MAX_STEPS, record, redo, startHistory, typingIn, undo } from "./history";

const same = (a: string, b: string) => a === b;

describe("undo and redo", () => {
  it("steps back and forward through recorded states", () => {
    let h = startHistory("a");
    h = record(h, "b", same);
    h = record(h, "c", same);
    h = undo(h);
    expect(h.present).toBe("b");
    h = undo(h);
    expect(h.present).toBe("a");
    h = redo(h);
    expect(h.present).toBe("b");
    h = redo(h);
    expect(h.present).toBe("c");
  });

  it("does nothing past either end", () => {
    const h = startHistory("a");
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("recording after an undo drops the undone states", () => {
    let h = record(record(startHistory("a"), "b", same), "c", same);
    h = record(undo(h), "x", same);
    expect(h.present).toBe("x");
    expect(h.future).toEqual([]);
    expect(undo(h).present).toBe("b");
  });

  it("ignores a state equal to the present", () => {
    const h = record(startHistory("a"), "b", same);
    expect(record(h, "b", same)).toBe(h);
  });

  it(`keeps at most ${MAX_STEPS} steps back`, () => {
    let h = startHistory(0);
    for (let i = 1; i <= MAX_STEPS + 20; i++) h = record(h, i, (x, y) => x === y);
    expect(h.past).toHaveLength(MAX_STEPS);
    expect(h.past[0]).toBe(20);
  });
});

describe("telling typing from a change", () => {
  it("sees adding or deleting characters in one field as typing", () => {
    expect(typingIn(["#12", "#fff"], ["#123", "#fff"])).toBe(0);
    expect(typingIn(["#123", "#fff"], ["#12", "#fff"])).toBe(0);
    expect(typingIn(["#000", "#ff"], ["#000", "#fff"])).toBe(1);
  });

  it("sees a replaced value, two fields at once or a list change as a step", () => {
    expect(typingIn(["#777777", "#fff"], ["#767676", "#fff"])).toBeNull();
    expect(typingIn(["#777", "#fff"], ["#fff", "#777"])).toBeNull();
    expect(typingIn(["a", "b", "c"], ["a", "b"])).toBeNull();
    expect(typingIn(["a"], ["a"])).toBeNull();
  });
});

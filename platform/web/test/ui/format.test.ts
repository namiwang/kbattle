import { describe, expect, it } from "vitest";
import { botsLabel, secondsLabel } from "../../src/ui/format";

describe("botsLabel: what the slots left over hold", () => {
  it("counts wanderers and campers the way slotsFor alternates them", () => {
    expect(botsLabel({ slots: 8, prompted: 1, doerOnly: 0 })).toBe("4 wanderers, 3 campers");
    expect(botsLabel({ slots: 16, prompted: 0, doerOnly: 0 })).toBe("8 wanderers, 8 campers");
    expect(botsLabel({ slots: 5, prompted: 1, doerOnly: 2 })).toBe("1 wanderer, 1 camper");
  });

  it("leaves out a kind there is none of, and says none when every slot is taken", () => {
    expect(botsLabel({ slots: 6, prompted: 2, doerOnly: 3 })).toBe("1 wanderer");
    expect(botsLabel({ slots: 4, prompted: 0, doerOnly: 4 })).toBe("none");
  });

  it("shows a dash when the counts do not add up", () => {
    expect(botsLabel({ slots: 8, prompted: 9, doerOnly: 0 })).toBe("—");
    expect(botsLabel({ slots: 8, prompted: 1.5, doerOnly: 0 })).toBe("—");
    expect(botsLabel({ slots: Number.NaN, prompted: 1, doerOnly: 0 })).toBe("—");
  });
});

describe("secondsLabel: a duration in ticks as sim seconds (50 ms a tick)", () => {
  it("converts whole and fractional seconds", () => {
    expect(secondsLabel(6000)).toBe("300 s");
    expect(secondsLabel(6001)).toBe("300.05 s");
    expect(secondsLabel(1)).toBe("0.05 s");
  });

  it("is empty for an emptied or non-finite input", () => {
    expect(secondsLabel(Number.NaN)).toBe("");
    expect(secondsLabel(Number.POSITIVE_INFINITY)).toBe("");
  });
});

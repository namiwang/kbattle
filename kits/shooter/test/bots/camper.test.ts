import { describe, expect, it } from "vitest";
import { makeBot } from "../../src/bots";
import { CAMP_INSET_M } from "../../src/bots/camper";
import { ARENA_HEIGHT_M, ARENA_WIDTH_M } from "../../src/constants";
import type { Observation } from "../../src/types";
import { decideAll, enemy, obs, picks } from "./helpers";

// Camper (DESIGN.md §6.2 Bots; sim ruling R13): heads for the nearest arena
// corner region, then stops and scans by turning left; faces the nearest
// visible enemy and fires when it is within 10°; when its HP dropped since its
// previous decision while in its corner, relocates to a different corner.

const camper = (seed = 1, slot = 0) => makeBot("camper", seed, slot);
const W = ARENA_WIDTH_M;
const H = ARENA_HEIGHT_M;
const spots = {
  nw: { x: CAMP_INSET_M, y: CAMP_INSET_M },
  ne: { x: W - CAMP_INSET_M, y: CAMP_INSET_M },
  se: { x: W - CAMP_INSET_M, y: H - CAMP_INSET_M },
  sw: { x: CAMP_INSET_M, y: H - CAMP_INSET_M },
};

describe("camper: holding a corner", () => {
  it("heads for the nearest corner with whichever move points closest, without turning", async () => {
    // From (30, 20) facing 0 the north-west spot lies at -149°: back. From (80, 90) facing 90 the south-east one at 18°: left.
    expect(picks((await decideAll(camper(), [obs({ pos: { x: 30, y: 20 }, facing: 0 })]))[0]!)).toEqual({
      move: "back",
      turn: "none",
      fire: 0,
      target: undefined,
    });
    expect(picks((await decideAll(camper(), [obs({ pos: { x: 80, y: 90 }, facing: 90 })]))[0]!)).toMatchObject({
      move: "left",
      turn: "none",
    });
  });

  it("stops once in its corner region and scans by turning left, decision after decision", async () => {
    const views = [obs({ pos: { x: 12, y: 9 } }), obs({ pos: { x: 7, y: 7 } }), obs({ pos: { x: 7, y: 7 }, facing: -90 })];
    expect((await decideAll(camper(), views)).map(picks)).toEqual([
      { move: "back", turn: "none", fire: 0, target: undefined },
      { move: "stop", turn: "left", fire: 0, target: undefined },
      { move: "stop", turn: "left", fire: 0, target: undefined },
    ]);
  });

  it("faces the nearest visible enemy, firing when it is within 10°, and holds its corner", async () => {
    const home = (visible: Observation["visible"]) => obs({ pos: { x: 6, y: 6 } }, { visible });
    const views = [home([enemy("a1", -4, 40), enemy("a2", 1, 50)]), home([enemy("a2", 25)])];
    const answers = (await decideAll(camper(), views)).map(picks);
    expect(answers).toEqual([
      { move: "stop", turn: "face_target", fire: 1, target: "a1" },
      { move: "stop", turn: "face_target", fire: 0, target: "a2" },
    ]);
  });
});

describe("camper: relocating", () => {
  /** Home in the north-west corner, then hit, then standing on `spot`: the move it picks there. */
  const afterHit = async (seed: number, spot: { x: number; y: number }) => {
    const views = [obs({ pos: { x: 6, y: 6 }, hp: 100 }), obs({ pos: { x: 6, y: 6 }, hp: 80 }), obs({ pos: spot, hp: 80 })];
    return (await decideAll(camper(seed), views)).map(picks);
  };

  it("leaves its corner when its HP dropped since the previous decision", async () => {
    const [before, hit] = await afterHit(1, spots.nw);
    expect(before).toMatchObject({ move: "stop", turn: "left" });
    expect(hit!.move).not.toBe("stop");
    expect(hit!.turn).toBe("none");
  });

  it("heads for a different corner: it stops on exactly one of the other three", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const stopsAt = [];
      for (const [name, spot] of Object.entries(spots)) {
        if ((await afterHit(seed, spot))[2]!.move === "stop") stopsAt.push(name);
      }
      expect(stopsAt, `seed ${seed}`).toHaveLength(1);
      expect(stopsAt[0], `seed ${seed}`).not.toBe("nw");
    }
  });

  it("already on its way, it keeps its new corner when hit again (no doubling back)", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      // Home in the north-west, hit, then hit again 1.5 m out, then standing on each corner spot in turn.
      const legs = async (spot: { x: number; y: number }) => {
        const views = [
          obs({ pos: { x: 6, y: 6 }, hp: 100 }),
          obs({ pos: { x: 6, y: 6 }, hp: 80 }),
          obs({ pos: { x: 7.5, y: 6 }, hp: 60 }),
          obs({ pos: spot, hp: 60 }),
        ];
        return (await decideAll(camper(seed), views)).map(picks);
      };
      const stopsAt = [];
      for (const [name, spot] of Object.entries(spots)) if ((await legs(spot))[3]!.move === "stop") stopsAt.push(name);
      const once = [];
      for (const [name, spot] of Object.entries(spots)) if ((await afterHit(seed, spot))[2]!.move === "stop") once.push(name);
      expect(stopsAt, `seed ${seed}`).toEqual(once); // the second hit changed nothing
    }
  });

  it("gives up on a corner it cannot reach: 3 decisions in a row without headway pick another", async () => {
    // Pressed against something on the way from the middle toward the north-west corner.
    const stuck = [0, 1, 2, 3].map(() => obs({ pos: { x: 30, y: 20 }, facing: 0 }));
    const moves = (await decideAll(camper(), stuck)).map((a) => picks(a).move);
    expect(moves.slice(0, 3)).toEqual(["back", "back", "back"]);
    expect(moves[3]).not.toBe("back");
  });
});

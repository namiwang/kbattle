import { describe, expect, it } from "vitest";
import { makeBot } from "../../src/bots";
import { decideAll, enemy, obs, picks } from "./helpers";

// Wanderer (DESIGN.md §6.2 Bots; sim ruling R13): walks forward along a heading;
// re-picks the heading after 3 decisions in a row without headway, or about
// every 4 s; faces the nearest visible enemy and fires when it is within 10°,
// still walking. It knows only its Observation.

const wanderer = (seed = 1, slot = 0) => makeBot("wanderer", seed, slot);
const walk = { move: "forward", turn: "none", fire: 0, target: undefined };

describe("wanderer: roaming", () => {
  it("walks forward along its facing when nobody is in view", async () => {
    const [first] = await decideAll(wanderer(), [obs({ facing: 30 })]);
    expect(picks(first!)).toEqual(walk);
    expect(first!.model).toBe("bot:wanderer");
  });

  it("keeps walking straight while it gains ground", async () => {
    // 2.5 m per decision: a full 10-tick walk at 5 m/s.
    const views = [0, 1, 2, 3, 4, 5].map((n) => obs({ pos: { x: 20 + 2.5 * n, y: 50 } }));
    expect((await decideAll(wanderer(), views)).map(picks)).toEqual(views.map(() => walk));
  });

  it("after 3 decisions in a row without headway, turns toward a new heading behind it", async () => {
    const stuck = [0, 1, 2, 3].map(() => obs({ pos: { x: 96, y: 50 }, facing: 0 }));
    const turns = (await decideAll(wanderer(), stuck)).map((a) => picks(a).turn);
    expect(turns.slice(0, 3)).toEqual(["none", "none", "none"]);
    expect(["left", "right"]).toContain(turns[3]);
  });

  it("headway resets the count", async () => {
    const at = (x: number) => obs({ pos: { x, y: 50 } });
    const views = [at(80), at(80), at(80), at(82.5), at(82.5), at(82.5), at(82.5)];
    const turns = (await decideAll(wanderer(), views)).map((a) => picks(a).turn);
    expect(turns).toEqual(["none", "none", "none", "none", "none", "none", turns[6]]);
    expect(turns[6]).not.toBe("none"); // the 4th still decision, 3 without headway
  });

  it("re-picks its heading after about 4 s (80 ticks) of walking", async () => {
    // Facing held at 0 while it walks: a re-pick shows as a turn whenever the new heading is over 45° away.
    const views = Array.from({ length: 10 }, (_, n) => obs({ pos: { x: 10 + 2.5 * n, y: 50 } }));
    let repicked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const turns = (await decideAll(wanderer(seed), views)).map((a) => picks(a).turn);
      expect(turns.slice(0, 8), `seed ${seed}`).toEqual(Array(8).fill("none")); // ticks 1..71
      if (turns[8] !== "none") repicked++; // tick 81
    }
    expect(repicked).toBeGreaterThanOrEqual(10);
  });
});

describe("wanderer: fighting", () => {
  it("faces the nearest visible enemy and fires when it is within 10°, still walking", async () => {
    const view = obs({}, { visible: [enemy("a2", 5, 20), enemy("a3", -2, 35)] });
    const [answer] = await decideAll(wanderer(), [view]);
    expect(picks(answer!)).toEqual({ move: "forward", turn: "face_target", fire: 1, target: "a2" });
  });

  it("10° is in; beyond it, it turns toward the enemy without firing", async () => {
    const fire = async (bearing: number) =>
      picks((await decideAll(wanderer(), [obs({}, { visible: [enemy("a1", bearing)] })]))[0]!);
    expect(await fire(10)).toMatchObject({ turn: "face_target", fire: 1, target: "a1" });
    expect(await fire(-10)).toMatchObject({ turn: "face_target", fire: 1, target: "a1" });
    expect(await fire(11)).toMatchObject({ turn: "face_target", fire: 0, target: "a1" });
    expect(await fire(-40)).toMatchObject({ move: "forward", turn: "face_target", fire: 0, target: "a1" });
  });

  it("when the enemy is gone, walks on the way it was last looking", async () => {
    const views = [obs({ facing: 0 }), obs({ facing: 0 }, { visible: [enemy("a1", 70)] }), obs({ facing: 70 })];
    const answers = (await decideAll(wanderer(), views)).map(picks);
    expect(answers[1]).toMatchObject({ turn: "face_target", target: "a1" });
    expect(answers[2]).toEqual(walk);
  });
});

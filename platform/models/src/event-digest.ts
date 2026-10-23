// "Since your last call" for the thinker (DESIGN.md §5.4): hits taken, kills, shots
// heard, enemies seen, newest first, cut to fit. Built only from the agent's own
// observations (principle 3), never from log events, which know who shot whom.
//
// Each line is one fact, most important first: hp lost, kills gained, incoming
// fire, shots heard by band, then one line per enemy seen, newest first. The cut
// drops whole lines from the end, so the oldest sightings go first.
//
// Note an observation once, in tick order. A note sees what perception reports at
// that tick: shots and near misses are facts of the perception window, the last
// DOER_INTERVAL_TICKS steps (sim ruling R15), so a caller that notes every doer
// tick sees each fact exactly once.
import { HEARING_BANDS, type AgentId, type HearingBand } from "@decision-arena/core/legacy";
// The shooter kit until R2.3 moves the digest: an accepted exception to the
// platform's dependency rule (ISSUES I-028).
import { bearingTo, normalizeDeg, vec2, type Observation, type Vec2 } from "@decision-arena/kit-shooter";

/**
 * The digest's default size in characters. With the other inputs at their caps,
 * the thinker input stays under 1,500 tokens (§5.4; thinker-prompt.test.ts).
 */
export const DIGEST_MAX_CHARS = 800;

export interface Digest {
  /** Takes in what the agent perceived at `tick`. */
  note(tick: number, observation: Observation): void;
  /** The digest of everything noted since the window started, at most `maxChars` characters, cut at a line end. */
  build(maxChars?: number): string;
  /** Starts a new window at the last note: call it when a thinker call goes out with this digest. */
  reset(): void;
}

/** Where an enemy stood when the agent last saw it. */
interface Sighting {
  tick: number;
  at: Vec2;
}

/** The agent's own state at its last note. */
interface Self {
  tick: number;
  pos: Vec2;
  facing: number;
  hp: number;
  kills: number;
}

export function createDigest(): Digest {
  let last: Self | null = null;
  // hp and kills when the window started; set by the first note after a start.
  let start: { hp: number; kills: number } | null = null;
  let incoming = 0;
  let shots = zeroShots();
  const seen = new Map<AgentId, Sighting>();

  return {
    note(tick, { self, visible, heard, incoming: fire }) {
      start ??= { hp: self.hp, kills: self.kills };
      last = { tick, pos: { ...self.pos }, facing: self.facing, hp: self.hp, kills: self.kills };
      incoming += fire.length;
      for (const sound of heard) if (sound.kind === "shot") shots[sound.dist] += 1;
      for (const enemy of visible) {
        const at = vec2.add(self.pos, vec2.scale(vec2.fromAngle(self.facing + enemy.bearing), enemy.dist));
        seen.set(enemy.id, { tick, at });
      }
    },

    build(maxChars = DIGEST_MAX_CHARS) {
      if (last === null || start === null) return "";
      const now = last;
      const lines: string[] = [];

      const lost = start.hp - now.hp;
      if (lost > 0) lines.push(`lost ${lost} hp (${start.hp} -> ${now.hp})`);
      const gained = now.kills - start.kills;
      if (gained > 0) lines.push(`killed ${gained} (${now.kills} in total)`);
      if (incoming > 0) lines.push(`incoming fire ${incoming} ${incoming === 1 ? "time" : "times"}`);
      const bands = HEARING_BANDS.filter((band) => shots[band] > 0).map((band) => `${shots[band]} ${band}`);
      if (bands.length > 0) lines.push(`heard shots: ${bands.join(", ")}`);

      // Each sighting as seen from where the agent is and faces now, newest first.
      const sightings = [...seen].map(([id, { tick, at }]) => ({
        id,
        tick,
        bearing: normalizeDeg(Math.round(bearingTo(now.pos, now.facing, at))),
        dist: vec2.dist(now.pos, at),
      }));
      sightings.sort((a, b) => b.tick - a.tick || a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const s of sightings) {
        lines.push(`${s.id} seen ${now.tick - s.tick} ticks ago at ${s.bearing}°, ${Math.round(s.dist)} m`);
      }

      return cutAtLineEnd(lines, maxChars);
    },

    reset() {
      start = last === null ? null : { hp: last.hp, kills: last.kills };
      incoming = 0;
      shots = zeroShots();
      seen.clear();
    },
  };
}

function zeroShots(): Record<HearingBand, number> {
  return { near: 0, mid: 0, far: 0 };
}

/** The leading lines that fit in `maxChars` characters, joined by newlines. */
function cutAtLineEnd(lines: string[], maxChars: number): string {
  let length = -1; // no newline before the first line
  let count = 0;
  for (const line of lines) {
    if (length + 1 + line.length > maxChars) break;
    length += 1 + line.length;
    count += 1;
  }
  return lines.slice(0, count).join("\n");
}

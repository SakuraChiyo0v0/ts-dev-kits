import { describe, expect, it } from "vitest";
import { parseProgressLines } from "../src/index.js";

describe("parseProgressLines", () => {
  it("parses a full progress event block", () => {
    const lines = [
      "frame=12",
      "fps=25.0",
      "bitrate=123.4kbits/s",
      "total_size=1024",
      "out_time_us=480000",
      "out_time_ms=480000",
      "out_time=00:00:00.480000",
      "dup_frames=0",
      "drop_frames=1",
      "speed=1.5x",
      "progress=continue",
      "progress=end",
    ];
    const events = parseProgressLines(lines, 2000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      frame: 12,
      fps: "25.0",
      bitrate: "123.4kbits/s",
      totalSize: 1024,
      outTimeUs: 480000,
      outTimeMs: 480000,
      outTime: "00:00:00.480000",
      dupFrames: 0,
      dropFrames: 1,
      speed: "1.5x",
      percent: 24,
    });
  });

  it("computes percent from out_time_us and total duration", () => {
    const events = parseProgressLines(["out_time_us=1500000", "progress=continue"], 3000);
    expect(events[0]?.percent).toBeCloseTo(50, 1);
  });

  it("returns an empty array for empty input", () => {
    expect(parseProgressLines([], undefined)).toEqual([]);
  });

  it("ignores unknown lines", () => {
    const events = parseProgressLines(["frame=1", "not-a-key", "progress=end"], undefined);
    expect(events).toHaveLength(1);
    expect(events[0]?.frame).toBe(1);
    expect(events[0]?.raw["not-a-key"]).toBeUndefined();
  });

  it("handles multiple events in one batch", () => {
    const events = parseProgressLines(
      [
        "frame=1",
        "out_time_us=100000",
        "progress=continue",
        "frame=2",
        "out_time_us=200000",
        "progress=end",
      ],
      1000,
    );
    expect(events).toHaveLength(2);
    expect(events[0]?.frame).toBe(1);
    expect(events[1]?.frame).toBe(2);
  });
});

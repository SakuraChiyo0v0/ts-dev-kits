import { describe, expect, it } from "vitest";

import {
  discoverLcuClient,
  isTencentServer,
  parseCommandLine,
  type ProcessReader,
} from "../src/index.js";

describe("parseCommandLine", () => {
  it("parses port, token and server from a full command line", () => {
    const cmdline =
      '"C:\\Riot Games\\League of Legends\\LeagueClientUx.exe" ' +
      '--app-port=54321 --remoting-auth-token=abc123 --rso_platform_id=HN1';
    expect(parseCommandLine(cmdline)).toEqual({
      port: 54321,
      token: "abc123",
      server: "HN1",
    });
  });

  it("handles missing server (international client)", () => {
    const cmdline = 'LeagueClientUx.exe --app-port=1111 --remoting-auth-token=xyz';
    expect(parseCommandLine(cmdline)).toEqual({ port: 1111, token: "xyz" });
  });

  it("returns empty object when nothing matches", () => {
    expect(parseCommandLine("some random process")).toEqual({});
  });
});

describe("discoverLcuClient", () => {
  function fakeReader(entries: Record<number, string>): ProcessReader {
    return {
      async findClientPids() {
        return Object.keys(entries).map(Number);
      },
      async readCommandLine(pid: number) {
        return entries[pid];
      },
    };
  }

  it("discovers connection info from the first client pid", async () => {
    const reader = fakeReader({
      100: 'LeagueClientUx.exe --app-port=9999 --remoting-auth-token=tok --rso_platform_id=NA1',
      200: 'LeagueClientUx.exe --app-port=8888 --remoting-auth-token=tok2',
    });
    const conn = await discoverLcuClient({ reader });
    expect(conn).toEqual({ pid: 100, port: 9999, token: "tok", server: "NA1" });
  });

  it("throws CLIENT_NOT_RUNNING when no client process exists", async () => {
    const reader = fakeReader({});
    await expect(discoverLcuClient({ reader })).rejects.toMatchObject({
      code: "CLIENT_NOT_RUNNING",
    });
  });

  it("throws DISCOVERY_FAILED when command line lacks port/token", async () => {
    const reader = fakeReader({ 100: "LeagueClientUx.exe --app-port=1234" });
    await expect(discoverLcuClient({ reader })).rejects.toMatchObject({
      code: "DISCOVERY_FAILED",
    });
  });

  it("throws DISCOVERY_FAILED when the process has gone away", async () => {
    const readerNoCmdline: ProcessReader = {
      async findClientPids() {
        return [100];
      },
      async readCommandLine() {
        return undefined;
      },
    };
    await expect(discoverLcuClient({ reader: readerNoCmdline })).rejects.toMatchObject({
      code: "DISCOVERY_FAILED",
    });
  });

  it("uses explicit pid when provided", async () => {
    const reader = fakeReader({
      100: 'LeagueClientUx.exe --app-port=1 --remoting-auth-token=a',
      200: 'LeagueClientUx.exe --app-port=2 --remoting-auth-token=b',
    });
    const conn = await discoverLcuClient({ pid: 200, reader });
    expect(conn.port).toBe(2);
  });
});

describe("isTencentServer", () => {
  it("recognizes Tencent platforms", () => {
    expect(isTencentServer("HN1")).toBe(true);
    expect(isTencentServer("hn10")).toBe(true);
    expect(isTencentServer("BGP2")).toBe(true);
    expect(isTencentServer("NJ100")).toBe(true);
  });

  it("rejects international/unknown servers", () => {
    expect(isTencentServer("NA1")).toBe(false);
    expect(isTencentServer("EUW1")).toBe(false);
    expect(isTencentServer(undefined)).toBe(false);
  });
});

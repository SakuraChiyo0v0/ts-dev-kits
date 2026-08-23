import { describe, it, expect } from "vitest";
import {
  accountIdToSteamId2,
  accountIdToSteamId3,
  accountIdToSteamId64,
  isSteamId64,
  parseSteamId,
  steamId2ToAccountId,
  steamId3ToAccountId,
  steamId64ToAccountId,
  steamId64ToSteamId2,
  steamId64ToSteamId3,
} from "../src/steamid.js";
import { SteamError } from "../src/errors.js";

// accountId 46217562 <-> steamID64 76561198006483290
const ACCOUNT_ID = 46217562;
const ID64 = "76561198006483290";

describe("steamid", () => {
  it("steamID64 解析", () => {
    const parsed = parseSteamId(ID64);
    expect(parsed).toEqual({ kind: "steamId64", id64: ID64, accountId: ACCOUNT_ID });
  });

  it("steamID3 解析", () => {
    expect(parseSteamId(`[U:1:${ACCOUNT_ID}]`)).toEqual({
      kind: "steamId64",
      id64: ID64,
      accountId: ACCOUNT_ID,
    });
  });

  it("steamID2 解析(STEAM_0:y:z)", () => {
    expect(parseSteamId("STEAM_0:0:23108781")).toEqual({
      kind: "steamId64",
      id64: ID64,
      accountId: ACCOUNT_ID,
    });
  });

  it("profile URL 解析", () => {
    expect(parseSteamId(`https://steamcommunity.com/profiles/${ID64}/`)).toEqual({
      kind: "steamId64",
      id64: ID64,
      accountId: ACCOUNT_ID,
    });
  });

  it("vanity URL 解析", () => {
    expect(parseSteamId("https://steamcommunity.com/id/DimGG/")).toEqual({
      kind: "vanity",
      vanity: "DimGG",
    });
  });

  it("裸 vanity 解析", () => {
    expect(parseSteamId("my_vanity-123")).toEqual({ kind: "vanity", vanity: "my_vanity-123" });
  });

  it("非法输入抛 INVALID_URL", () => {
    expect(() => parseSteamId("!!!")).toThrowError(expect.objectContaining({ code: "INVALID_URL" }));
    expect(() => parseSteamId("")).toThrowError(expect.objectContaining({ code: "INVALID_URL" }));
    expect(() => parseSteamId("  ")).toThrowError(expect.objectContaining({ code: "INVALID_URL" }));
  });

  it("accountId 与 steamID64 互转", () => {
    expect(accountIdToSteamId64(ACCOUNT_ID)).toBe(ID64);
    expect(steamId64ToAccountId(ID64)).toBe(ACCOUNT_ID);
    expect(() => steamId64ToAccountId("0")).toThrowError(expect.objectContaining({ code: "INVALID_URL" }));
  });

  it("steamID64 → steamID2 / steamID3", () => {
    expect(steamId64ToSteamId2(ID64)).toBe("STEAM_1:0:23108781");
    expect(steamId64ToSteamId3(ID64)).toBe(`[U:1:${ACCOUNT_ID}]`);
    expect(accountIdToSteamId2(ACCOUNT_ID)).toBe("STEAM_1:0:23108781");
    expect(accountIdToSteamId3(ACCOUNT_ID)).toBe(`[U:1:${ACCOUNT_ID}]`);
  });

  it("steamID2/3 → accountId", () => {
    expect(steamId2ToAccountId("STEAM_0:0:23108781")).toBe(ACCOUNT_ID);
    expect(steamId3ToAccountId(`[U:1:${ACCOUNT_ID}]`)).toBe(ACCOUNT_ID);
  });

  it("isSteamId64", () => {
    expect(isSteamId64(ID64)).toBe(true);
    expect(isSteamId64("12345")).toBe(false);
    expect(isSteamId64("7656119800648329x")).toBe(false);
  });

  it("accountId 越界抛 INVALID_URL", () => {
    expect(() => accountIdToSteamId64(4294967296)).toThrowError(SteamError);
    expect(() => accountIdToSteamId64(-1)).toThrowError(SteamError);
  });
});

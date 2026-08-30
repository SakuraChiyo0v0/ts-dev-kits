import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSseEvent, splitSseChunks } from "../src/client/src/lib/kazumi-sse";

test("batch：正常解析 items", () => {
  const ev = parseSseEvent(
    'event: batch\ndata: {"items":[{"name":"鬼灭之刃","src":"https://a.com","rule":"a"}]}',
  );
  assert.equal(ev.type, "batch");
  if (ev.type === "batch") {
    assert.equal(ev.items.length, 1);
    assert.equal(ev.items[0]?.name, "鬼灭之刃");
  }
});

test("batch：data 值内含 \\n 转义（JSON.stringify 单行输出）仍能解析", () => {
  // 服务端 send() 用 JSON.stringify 单行输出，值里的换行是 \n 转义而非真实换行。
  const ev = parseSseEvent('event: batch\ndata: {"items":[{"name":"a\\nb","src":"s","rule":"r"}]}');
  assert.equal(ev.type, "batch");
  if (ev.type === "batch") assert.equal(ev.items[0]?.name, "a\nb");
});

test("batch：空 data: 行返回 unknown（不抛错）", () => {
  const ev = parseSseEvent("event: batch\ndata: ");
  assert.equal(ev.type, "unknown");
});

test("batch：data 非法 JSON 返回 unknown（不抛错）", () => {
  const ev = parseSseEvent("event: batch\ndata: {oops");
  assert.equal(ev.type, "unknown");
});

test("done：返回 done", () => {
  const ev = parseSseEvent("event: done\ndata: {}");
  assert.equal(ev.type, "done");
});

test("error：带 message 解析出 message", () => {
  const ev = parseSseEvent('event: error\ndata: {"message":"搜索失败（可能被验证码拦截）"}');
  assert.equal(ev.type, "error");
  if (ev.type === "error") assert.equal(ev.message, "搜索失败（可能被验证码拦截）");
});

test("error：空 data 兜底默认 message", () => {
  const ev = parseSseEvent("event: error\ndata: ");
  assert.equal(ev.type, "error");
  if (ev.type === "error") assert.equal(ev.message, "搜索失败（可能被验证码拦截）");
});

test("未知事件类型返回 unknown", () => {
  const ev = parseSseEvent("event: ping\ndata: {}");
  assert.equal(ev.type, "unknown");
});

test("splitSseChunks：按 \\n\\n 切分并保留未完成尾部", () => {
  const { parts, rest } = splitSseChunks(
    'event: batch\ndata: {"items":[]}\n\nevent: done\ndata: {}\n\nevent: batch\ndata: {"i',
  );
  assert.equal(parts.length, 2);
  assert.equal(rest, 'event: batch\ndata: {"i');
});

test("splitSseChunks：跨 chunk 半包在下次拼全后解析（模拟 reader.read 分片）", () => {
  // 模拟两段网络分片：第一段只到一半，第二段补全。
  const chunk1 = 'event: batch\ndata: {"items":[{"name":"鬼灭之刃","src":"s",';
  const chunk2 = '"rule":"r"}]}\n\n';
  const s1 = splitSseChunks(chunk1);
  assert.equal(s1.parts.length, 0);
  assert.equal(s1.rest, chunk1);
  const s2 = splitSseChunks(s1.rest + chunk2);
  assert.equal(s2.parts.length, 1);
  const ev = parseSseEvent(s2.parts[0]!);
  assert.equal(ev.type, "batch");
  if (ev.type === "batch") assert.equal(ev.items[0]?.rule, "r");
});

test("splitSseChunks：空白事件块被过滤", () => {
  const { parts } = splitSseChunks("event: done\ndata: {}\n\n\n\n");
  assert.equal(parts.length, 1);
});

#!/usr/bin/env node
import {
  CliError,
  getBool,
  getNumber,
  getString,
  handleCliError,
  outputJson,
  outputText,
  parseArgs,
  printHelp,
  requireString,
} from "@sakurachiyo0v0/cli-utils";
import { AuthStore, qrcodeLogin } from "@sakurachiyo0v0/account";
import { writeFileSync } from "node:fs";
import { bilibiliQrAdapter } from "../auth/index.js";
import { createBilibiliClient } from "../index.js";

const USAGE = "Usage: sc-bilibili <command> [options]";

const COMMANDS = [
  { name: "login", desc: "Scan QR code to log in (opens browser window)" },
  { name: "logout", desc: "Clear stored login" },
  { name: "status", desc: "Show login status" },
  { name: "parse", desc: "Parse a bilibili URL into media items" },
  { name: "space", desc: "List videos of an UP space (--pn --ps --order --tid --min-duration)" },
  { name: "streams", desc: "Get play streams for a media item" },
  { name: "download", desc: "Download a media item (with merge)" },
  { name: "fav", desc: "Favorites management (list/info/create/edit/delete/add/remove)" },
  { name: "relation", desc: "Follow management (follow/unfollow/block/followings/followers)" },
  { name: "tag", desc: "Follow tag management (list/create/rename/delete/users)" },
  { name: "help", desc: "Show this help" },
];

const FAV_COMMANDS = [
  { name: "list <mid>", desc: "List folders created by a user" },
  { name: "collected <mid>", desc: "List folders collected by a user" },
  { name: "info <mediaId>", desc: "Show folder metadata" },
  { name: "videos <mediaId>", desc: "List folder contents (--pn --ps)" },
  { name: "create <title>", desc: "Create a folder (--intro --private)" },
  { name: "edit <mediaId> <title>", desc: "Edit a folder (--intro --private)" },
  { name: "delete <mediaIds...>", desc: "Delete folders (comma or space separated)" },
  { name: "add <rid> <mediaIds...>", desc: "Favourite a video into folders" },
  { name: "remove <rid> <mediaIds...>", desc: "Unfavourite a video from folders" },
];

const RELATION_COMMANDS = [
  { name: "follow <mid>", desc: "Follow a user" },
  { name: "unfollow <mid>", desc: "Unfollow a user" },
  { name: "block <mid>", desc: "Block a user" },
  { name: "unblock <mid>", desc: "Unblock a user" },
  { name: "followings <vmid>", desc: "List followings (--pn --ps)" },
  { name: "followers <vmid>", desc: "List followers (--pn --ps)" },
  { name: "stat <vmid>", desc: "Show relation statistics" },
  { name: "blacks", desc: "List blacklist" },
];

const TAG_COMMANDS = [
  { name: "list", desc: "List follow tags" },
  { name: "users <tagid>", desc: "List users in a tag (--pn --ps)" },
  { name: "create <name>", desc: "Create a tag" },
  { name: "rename <tagid> <name>", desc: "Rename a tag" },
  { name: "delete <tagid>", desc: "Delete a tag" },
  { name: "add <mid> <tagids...>", desc: "Add a user to tags" },
  { name: "remove <mid>", desc: "Remove a user from tags (back to default)" },
];

const OPTIONS = [
  { flag: "--url <url>", desc: "Bilibili URL to parse" },
  { flag: "--cookie <cookie>", desc: "Login cookie (SESSDATA=...; bili_jct=...)" },
  { flag: "--auth-path <path>", desc: "Auth store file path (default: platform user config dir)" },
  { flag: "--no-browser", desc: "Do not open browser window (print QR url only)" },
  { flag: "--qr-image <path>", desc: "Write QR code image to <path> for chat/remote display; also disables browser" },
  { flag: "--timeout <sec>", desc: "Login timeout in seconds (default 180)" },
  { flag: "--output-dir <dir>", desc: "Output directory" },
  { flag: "--quality <n>", desc: "Target quality (80=1080P, 64=720P)" },
  { flag: "--codec <n>", desc: "Video codec (7=AVC, 12=HEVC, 13=AV1)" },
  { flag: "--no-merge", desc: "Skip ffmpeg merge" },
  { flag: "--concurrency <n>", desc: "Download concurrency (default 4)" },
  { flag: "--index <n>", desc: "Media item index (default 0)" },
  { flag: "--pn <n>", desc: "Page number (default 1)" },
  { flag: "--ps <n>", desc: "Page size (default 40, max 50)" },
  { flag: "--order <key>", desc: "Sort: pubdate | click | favorite" },
  { flag: "--tid <n>", desc: "Filter by partition tid (0=all)" },
  { flag: "--min-duration <min>", desc: "Only keep videos longer than <min> minutes" },
];

function makeClient(args: ReturnType<typeof parseArgs>) {
  const cookie = getString(args, "cookie") ?? process.env.BILI_COOKIE;
  const authPath = getString(args, "auth-path") ?? process.env.BILI_AUTH_PATH;
  return createBilibiliClient({
    ...(cookie !== undefined ? { cookie } : {}),
    ...(authPath !== undefined ? { authPath } : {}),
    download: {
      ...(getNumber(args, "concurrency") !== undefined ? { concurrency: getNumber(args, "concurrency")! } : {}),
    },
  });
}

/** 从 CLI 参数提取列表解析选项(分页/排序/分区)。 */
function listOptions(args: ReturnType<typeof parseArgs>) {
  return {
    ...(getNumber(args, "pn") !== undefined ? { pn: getNumber(args, "pn")! } : {}),
    ...(getNumber(args, "ps") !== undefined ? { ps: getNumber(args, "ps")! } : {}),
    ...(getString(args, "order") !== undefined ? { order: getString(args, "order")! } : {}),
    ...(getNumber(args, "tid") !== undefined ? { tid: getNumber(args, "tid")! } : {}),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp(USAGE, COMMANDS, OPTIONS);
    return;
  }
  const command = argv[0] ?? "";
  const args = parseArgs(argv.slice(1));

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printHelp(USAGE, COMMANDS, OPTIONS);
      return;

    case "login": {
      const authPath = getString(args, "auth-path") ?? process.env.BILI_AUTH_PATH;
      const store = new AuthStore({
        platform: "bilibili",
        ...(authPath !== undefined ? { path: authPath } : {}),
      });
      const noBrowser = getBool(args, "no-browser");
      const qrImage = getString(args, "qr-image");
      const timeoutSec = getNumber(args, "timeout");
      outputText(
        qrImage !== undefined
          ? `登录:二维码图片将写入 ${qrImage},请用哔哩哔哩 App 扫码...`
          : noBrowser
            ? "登录:打印二维码地址,请手动打开扫码"
            : "登录:正在打开浏览器窗口,请用哔哩哔哩 App 扫码...",
      );
      const result = await qrcodeLogin({
        adapter: bilibiliQrAdapter(),
        store,
        autoOpenBrowser: !noBrowser && qrImage === undefined,
        ...(qrImage !== undefined ? { onQrCode: (dataUrl) => writeQrImage(qrImage, dataUrl) } : {}),
        ...(timeoutSec !== undefined ? { timeoutMs: timeoutSec * 1000 } : {}),
      });
      if (result.saved) {
        outputJson({ ok: true, authPath: store.path, savedAt: new Date().toISOString() });
      } else {
        outputJson({ ok: true, credentials: result.credentials });
      }
      return;
    }

    case "logout": {
      const authPath = getString(args, "auth-path") ?? process.env.BILI_AUTH_PATH;
      const store = new AuthStore({
        platform: "bilibili",
        ...(authPath !== undefined ? { path: authPath } : {}),
      });
      await store.clear();
      outputJson({ ok: true, authPath: store.path });
      return;
    }

    case "status": {
      const authPath = getString(args, "auth-path") ?? process.env.BILI_AUTH_PATH;
      const store = new AuthStore({
        platform: "bilibili",
        ...(authPath !== undefined ? { path: authPath } : {}),
      });
      const payload = await store.load();
      if (payload === null) {
        outputJson({ ok: true, loggedIn: false, authPath: store.path });
        return;
      }
      outputJson({
        ok: true,
        loggedIn: true,
        authPath: store.path,
        savedAt: payload.savedAt,
        ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
      });
      return;
    }

    case "parse": {
      const url = requireString(args, "url", "bilibili URL");
      const client = makeClient(args);
      const items = await client.parse(url, listOptions(args));
      outputJson(items);
      return;
    }

    case "space": {
      const target = args.positionals[0] ?? requireString(args, "mid", "user mid");
      const url = /^\d+$/u.test(target) ? `https://space.bilibili.com/${target}` : target;
      const client = makeClient(args);
      const items = await client.parse(url, listOptions(args));
      const minDuration = getNumber(args, "min-duration");
      const filtered =
        minDuration !== undefined
          ? items.filter((item) => item.duration !== undefined && item.duration >= minDuration * 60)
          : items;
      outputJson(filtered);
      return;
    }

    case "streams": {
      const url = requireString(args, "url", "bilibili URL");
      const client = makeClient(args);
      const items = await client.parse(url);
      const index = getNumber(args, "index") ?? 0;
      const item = items[index];
      if (item === undefined) {
        throw new CliError(`No media item at index ${index}`);
      }
      const streams = await client.getStreams(item, {
        ...(getNumber(args, "quality") !== undefined ? { quality: getNumber(args, "quality")! } : {}),
        ...(getNumber(args, "codec") !== undefined ? { codec: getNumber(args, "codec")! as 7 | 12 | 13 } : {}),
      });
      outputJson(streams);
      return;
    }

    case "download": {
      const url = requireString(args, "url", "bilibili URL");
      const outputDir = requireString(args, "output-dir", "output directory");
      const client = makeClient(args);
      const items = await client.parse(url);
      const index = getNumber(args, "index") ?? 0;
      const item = items[index];
      if (item === undefined) {
        throw new CliError(`No media item at index ${index}`);
      }
      const merge = getBool(args, "no-merge") ? false : true;
      const output = await client.download(item, {
        outputDir,
        merge,
        ...(getNumber(args, "quality") !== undefined ? { quality: getNumber(args, "quality")! } : {}),
      });
      outputJson({ ok: true, output });
      return;
    }

    case "fav":
      await runFavCommand(args);
      return;

    case "relation":
      await runRelationCommand(args);
      return;

    case "tag":
      await runTagCommand(args);
      return;

    default:
      outputText(`Unknown command: ${command}`);
      printHelp(USAGE, COMMANDS, OPTIONS);
      throw new CliError(`Unknown command: ${command}`, 2);
  }
}

/** 收藏夹管理子命令。 */
async function runFavCommand(args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[0];
  if (sub === undefined || sub === "help") {
    printHelp("Usage: sc-bilibili fav <command> [args]", FAV_COMMANDS, [
      { flag: "--pn <n>", desc: "Page number (default 1)" },
      { flag: "--ps <n>", desc: "Page size (default 20, max 20)" },
      { flag: "--intro <text>", desc: "Folder intro" },
      { flag: "--private", desc: "Create private folder" },
    ]);
    return;
  }
  const client = makeClient(args);
  const rest = args.positionals.slice(1);

  switch (sub) {
    case "list": {
      const mid = rest[0] ?? requireString(args, "mid", "user mid");
      const folders = await client.fav.listCreatedFolders(mid);
      outputJson(folders);
      return;
    }
    case "collected": {
      const mid = rest[0] ?? requireString(args, "mid", "user mid");
      const folders = await client.fav.listCollectedFolders(mid, {
        ...(getNumber(args, "pn") !== undefined ? { pn: getNumber(args, "pn")! } : {}),
        ...(getNumber(args, "ps") !== undefined ? { ps: getNumber(args, "ps")! } : {}),
      });
      outputJson(folders);
      return;
    }
    case "info": {
      const mediaId = rest[0] ?? requireString(args, "media-id", "media id");
      outputJson(await client.fav.getFolderInfo(mediaId));
      return;
    }
    case "videos": {
      const mediaId = rest[0] ?? requireString(args, "media-id", "media id");
      const page = await client.fav.listResources(mediaId, {
        ...(getNumber(args, "pn") !== undefined ? { pn: getNumber(args, "pn")! } : {}),
        ...(getNumber(args, "ps") !== undefined ? { ps: getNumber(args, "ps")! } : {}),
      });
      outputJson(page);
      return;
    }
    case "create": {
      const title = rest[0] ?? requireString(args, "title", "folder title");
      const id = await client.fav.createFolder({
        title,
        ...(getString(args, "intro") !== undefined ? { intro: getString(args, "intro")! } : {}),
        ...(getBool(args, "private") ? { privacy: 1 as const } : {}),
      });
      outputJson({ ok: true, mediaId: id });
      return;
    }
    case "edit": {
      const mediaId = rest[0] ?? requireString(args, "media-id", "media id");
      const title = rest[1] ?? requireString(args, "title", "folder title");
      await client.fav.editFolder(mediaId, {
        title,
        ...(getString(args, "intro") !== undefined ? { intro: getString(args, "intro")! } : {}),
        ...(getBool(args, "private") ? { privacy: 1 as const } : {}),
      });
      outputJson({ ok: true });
      return;
    }
    case "delete": {
      const ids = splitIds(rest.length > 0 ? rest : (getString(args, "media-ids") ?? ""));
      if (ids.length === 0) {
        throw new CliError("Missing folder media ids");
      }
      await client.fav.deleteFolder(ids);
      outputJson({ ok: true, mediaIds: ids });
      return;
    }
    case "add":
    case "remove": {
      const rid = rest[0] ?? requireString(args, "rid", "video avid");
      const mediaIds = splitIds(rest.slice(1).length > 0 ? rest.slice(1) : (getString(args, "media-ids") ?? ""));
      if (mediaIds.length === 0) {
        throw new CliError("Missing folder media ids");
      }
      if (sub === "add") {
        await client.fav.addVideo(rid, mediaIds);
      } else {
        await client.fav.removeVideo(rid, mediaIds);
      }
      outputJson({ ok: true, rid, mediaIds });
      return;
    }
    default:
      outputText(`Unknown fav command: ${sub}`);
      printHelp("Usage: sc-bilibili fav <command> [args]", FAV_COMMANDS, []);
      throw new CliError(`Unknown fav command: ${sub}`, 2);
  }
}

/** 关注关系子命令。 */
async function runRelationCommand(args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[0];
  if (sub === undefined || sub === "help") {
    printHelp("Usage: sc-bilibili relation <command> [args]", RELATION_COMMANDS, [
      { flag: "--pn <n>", desc: "Page number (default 1)" },
      { flag: "--ps <n>", desc: "Page size (default 50)" },
    ]);
    return;
  }
  const client = makeClient(args);
  const rest = args.positionals.slice(1);

  switch (sub) {
    case "follow":
    case "unfollow":
    case "block":
    case "unblock": {
      const mid = rest[0] ?? requireString(args, "mid", "user mid");
      if (sub === "follow") await client.relation.follow(mid);
      else if (sub === "unfollow") await client.relation.unfollow(mid);
      else if (sub === "block") await client.relation.block(mid);
      else await client.relation.unblock(mid);
      outputJson({ ok: true, action: sub, mid });
      return;
    }
    case "followings": {
      const vmid = rest[0] ?? requireString(args, "vmid", "user mid");
      const page = await client.relation.listFollowings(vmid, {
        ...(getNumber(args, "pn") !== undefined ? { pn: getNumber(args, "pn")! } : {}),
        ...(getNumber(args, "ps") !== undefined ? { ps: getNumber(args, "ps")! } : {}),
      });
      outputJson(page);
      return;
    }
    case "followers": {
      const vmid = rest[0] ?? requireString(args, "vmid", "user mid");
      const page = await client.relation.listFollowers(vmid, {
        ...(getNumber(args, "pn") !== undefined ? { pn: getNumber(args, "pn")! } : {}),
        ...(getNumber(args, "ps") !== undefined ? { ps: getNumber(args, "ps")! } : {}),
      });
      outputJson(page);
      return;
    }
    case "stat": {
      const vmid = rest[0] ?? requireString(args, "vmid", "user mid");
      outputJson(await client.relation.getStat(vmid));
      return;
    }
    case "blacks":
      outputJson(await client.relation.listBlacks());
      return;
    default:
      outputText(`Unknown relation command: ${sub}`);
      printHelp("Usage: sc-bilibili relation <command> [args]", RELATION_COMMANDS, []);
      throw new CliError(`Unknown relation command: ${sub}`, 2);
  }
}

/** 关注分组子命令。 */
async function runTagCommand(args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[0];
  if (sub === undefined || sub === "help") {
    printHelp("Usage: sc-bilibili tag <command> [args]", TAG_COMMANDS, [
      { flag: "--pn <n>", desc: "Page number (default 1)" },
      { flag: "--ps <n>", desc: "Page size (default 20)" },
    ]);
    return;
  }
  const client = makeClient(args);
  const rest = args.positionals.slice(1);

  switch (sub) {
    case "list":
      outputJson(await client.tag.listTags());
      return;
    case "users": {
      const tagid = rest[0] ?? requireString(args, "tagid", "tag id");
      const users = await client.tag.listTagUsers(tagid, {
        ...(getNumber(args, "pn") !== undefined ? { pn: getNumber(args, "pn")! } : {}),
        ...(getNumber(args, "ps") !== undefined ? { ps: getNumber(args, "ps")! } : {}),
      });
      outputJson(users);
      return;
    }
    case "create": {
      const name = rest[0] ?? requireString(args, "name", "tag name");
      const tagid = await client.tag.createTag(name);
      outputJson({ ok: true, tagid });
      return;
    }
    case "rename": {
      const tagid = rest[0] ?? requireString(args, "tagid", "tag id");
      const name = rest[1] ?? requireString(args, "name", "tag name");
      await client.tag.renameTag(tagid, name);
      outputJson({ ok: true });
      return;
    }
    case "delete": {
      const tagid = rest[0] ?? requireString(args, "tagid", "tag id");
      await client.tag.deleteTag(tagid);
      outputJson({ ok: true });
      return;
    }
    case "add": {
      const mid = rest[0] ?? requireString(args, "mid", "user mid");
      const tagids = splitIds(rest.slice(1).length > 0 ? rest.slice(1) : (getString(args, "tagids") ?? ""));
      if (tagids.length === 0) {
        throw new CliError("Missing tag ids");
      }
      await client.tag.addUsersToTags([mid], tagids);
      outputJson({ ok: true, mid, tagids });
      return;
    }
    case "remove": {
      const mid = rest[0] ?? requireString(args, "mid", "user mid");
      await client.tag.removeUsersFromTags([mid]);
      outputJson({ ok: true, mid });
      return;
    }
    default:
      outputText(`Unknown tag command: ${sub}`);
      printHelp("Usage: sc-bilibili tag <command> [args]", TAG_COMMANDS, []);
      throw new CliError(`Unknown tag command: ${sub}`, 2);
  }
}

/** 把位置参数或逗号分隔串解析为 id 列表(去空)。 */
function splitIds(input: string[] | string): string[] {
  const source = Array.isArray(input) ? input : [input];
  return source.flatMap((part) => part.split(",")).map((s) => s.trim()).filter((s) => s !== "");
}

/** 把二维码 data URL 写入 PNG 文件(供聊天/远程渠道展示给用户扫码)。 */
function writeQrImage(filePath: string, dataUrl: string): void {
  const base64 = dataUrl.split(",")[1];
  if (base64 === undefined) {
    throw new Error(`二维码图片格式异常: ${dataUrl.slice(0, 30)}`);
  }
  writeFileSync(filePath, Buffer.from(base64, "base64"));
  outputText(`二维码图片已写入: ${filePath}`);
}

main().catch(handleCliError);

#!/usr/bin/env node
/**
 * amechan-vrchat CLI:login / logout / status。
 * 测试/自定义网关支持环境变量注入:
 *   AMECHAN_VRCHAT_BASE_URL  — 覆盖 API baseUrl(测试用 mock 服务器)
 *   AMECHAN_VRCHAT_AUTH_PATH — 覆盖登录态存储路径
 */
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { AuthStore, AccountError } from "@sakurachiyo0v0/account";
import {
  getString,
  handleCliError,
  outputError,
  outputJson,
  outputText,
  printHelp,
  parseArgs,
} from "@sakurachiyo0v0/cli-utils";
import { createVrchatClient } from "../client.js";
import { FriendsApi } from "../endpoints/friends.js";
import { VrchatError } from "../errors.js";

const USAGE = "amechan-vrchat <command> [options]";
const COMMANDS = [
  { name: "help", desc: "显示帮助" },
  { name: "login [username]", desc: "密码登录(支持 2FA)并持久化登录态" },
  { name: "status", desc: "显示登录状态" },
  { name: "logout", desc: "登出并删除存储的登录态" },
  { name: "users", desc: "用户查询(get/profile/search/friend-status/worlds/groups/mutuals/avatar/active/update-status/update-bio)" },
  { name: "worlds", desc: "世界查询与发布(get/search/favorites/recent/active/add-tags/remove-tags/publish)" },
  { name: "avatars", desc: "头像查询与选择(get/search/owned/favorites/licensed/styles/select)" },
  { name: "instances", desc: "实例查询(get/recent)" },
  { name: "friends", desc: "好友管理(list/online/add/remove)" },
  { name: "notifications", desc: "通知管理(list/get/accept/hide/see/reply/clear)" },
  { name: "favorites", desc: "收藏管理(list/add/remove/groups/by-group)" },
  { name: "groups", desc: "群组管理(get/search/members/member/roles/role-templates/instances/permissions/requests/approve/bans/ban/unban/join/leave/announcement/announce)" },
  { name: "files", desc: "文件管理(get/list/create/create-image/delete)" },
  { name: "permissions", desc: "权限查询(list/get)" },
  { name: "system", desc: "系统信息(health/stats/time)" },
  { name: "economy", desc: "余额与交易(balance/transactions)" },
  { name: "moderation", desc: "审核管理(list/create/unmoderate/report)" },
  { name: "invite", desc: "邀请管理(invite/request/join/respond)" },
  { name: "messages", desc: "快捷消息管理(list/get/update)" },
];
const USERS_COMMANDS = [
  { name: "get <userId>", desc: "按 ID 获取用户" },
  { name: "profile <userId>", desc: "获取用户公开资料" },
  { name: "search <query>", desc: "搜索用户(--n --offset)" },
  { name: "friend-status <userId>", desc: "查看与某用户的好友状态" },
  { name: "worlds <userId>", desc: "查看用户发布的世界" },
  { name: "groups <userId>", desc: "查看用户加入的群组" },
  { name: "mutuals <userId>", desc: "查看与用户的共同好友" },
  { name: "avatar <userId>", desc: "查看用户的当前头像" },
  { name: "active", desc: "活跃用户列表(--n --offset)" },
  { name: "update-status <text>", desc: "更新自己的状态文本" },
  { name: "update-bio <text>", desc: "更新自己的个人简介" },
];
const WORLDS_COMMANDS = [
  { name: "get <worldId>", desc: "按 ID 获取世界" },
  { name: "search <query>", desc: "搜索世界(--n --offset --sort)" },
  { name: "favorites", desc: "收藏的世界(--n --offset)" },
  { name: "recent", desc: "最近访问的世界(--n --offset)" },
  { name: "active", desc: "活跃的世界(--n --offset)" },
  { name: "add-tags <worldId> <tag>", desc: "给世界添加标签" },
  { name: "remove-tags <worldId> <tag>", desc: "移除世界标签" },
  { name: "publish <worldId>", desc: "发布世界(公开)" },
];
const AVATARS_COMMANDS = [
  { name: "get <avatarId>", desc: "按 ID 获取头像" },
  { name: "search <query>", desc: "搜索头像(--n --offset)" },
  { name: "owned <userId>", desc: "查看用户拥有的头像" },
  { name: "favorites", desc: "查看收藏的头像(--n --offset)" },
  { name: "licensed", desc: "查看授权头像(--n --offset)" },
  { name: "styles", desc: "查看头像风格(无需登录)" },
  { name: "select <avatarId>", desc: "选择当前使用的头像" },
];
const INSTANCES_COMMANDS = [
  { name: "get <worldId> <instanceId>", desc: "按 世界ID 实例ID 获取实例" },
  { name: "short-name <worldId> <instanceId>", desc: "获取实例短码" },
  { name: "recent", desc: "最近访问的实例(--n --offset)" },
];
const FRIENDS_COMMANDS = [
  { name: "list", desc: "好友列表(--n --offset)" },
  { name: "online", desc: "在线好友(含所在世界名)" },
  { name: "add <userId>", desc: "发送好友请求" },
  { name: "remove <userId>", desc: "删除好友" },
];
const NOTIFICATIONS_COMMANDS = [
  { name: "list", desc: "通知列表(--type --n --offset)" },
  { name: "get <notificationId>", desc: "单条通知详情" },
  { name: "accept <notificationId>", desc: "接受通知(好友请求/邀请)" },
  { name: "hide <notificationId>", desc: "隐藏/拒绝通知" },
  { name: "see <notificationId>", desc: "标记已读" },
  { name: "reply <notificationId> <message>", desc: "回复通知" },
  { name: "clear", desc: "清除所有已读通知" },
];
const FAVORITES_COMMANDS = [
  { name: "list", desc: "收藏列表(--type)" },
  { name: "add <type> <favoriteId>", desc: "添加收藏(如 avatar <avatarId>)" },
  { name: "remove <favoriteId>", desc: "删除收藏" },
  { name: "groups <type>", desc: "收藏分组列表" },
  { name: "by-group <type> <groupName> <userId>", desc: "按分组获取收藏" },
];
const GROUPS_COMMANDS = [
  { name: "get <groupId>", desc: "按 ID 获取群组" },
  { name: "search <query>", desc: "搜索群组(--n --offset)" },
  { name: "members <groupId>", desc: "群组成员列表(--n --offset)" },
  { name: "member <groupId> <userId>", desc: "单个成员详情" },
  { name: "remove-member <groupId> <userId>", desc: "移除成员" },
  { name: "add-role <groupId> <userId> <roleId>", desc: "给成员分配角色" },
  { name: "remove-role <groupId> <userId> <roleId>", desc: "移除成员角色" },
  { name: "roles <groupId>", desc: "群组角色列表" },
  { name: "role-templates", desc: "群组角色模板" },
  { name: "instances <groupId>", desc: "群组实例列表" },
  { name: "permissions <groupId>", desc: "群组权限列表" },
  { name: "requests <groupId>", desc: "加入申请列表" },
  { name: "approve <groupId> <userId>", desc: "批准加入申请" },
  { name: "bans <groupId>", desc: "封禁列表" },
  { name: "ban <groupId> <userId>", desc: "封禁用户" },
  { name: "unban <groupId> <userId>", desc: "解除封禁" },
  { name: "join <groupId>", desc: "加入群组" },
  { name: "leave <groupId>", desc: "离开群组" },
  { name: "announcement <groupId>", desc: "查看群组公告" },
  { name: "announce <groupId> <message>", desc: "发布群组公告" },
];
const FILES_COMMANDS = [
  { name: "get <fileId>", desc: "按 ID 获取文件" },
  { name: "list", desc: "列出当前用户文件(--n --offset)" },
  { name: "create <name> <mimeType> <extension>", desc: "创建文件(如 png image/png .png)" },
  { name: "create-image <name> <mimeType> <extension>", desc: "创建图片文件" },
  { name: "delete <fileId>", desc: "删除文件" },
];
const PERMISSIONS_COMMANDS = [
  { name: "list", desc: "全部权限位" },
  { name: "get <permissionId>", desc: "按 ID 获取权限位" },
];
const SYSTEM_COMMANDS = [
  { name: "health", desc: "健康检查" },
  { name: "stats", desc: "在线统计" },
  { name: "time", desc: "当前时间" },
];
const ECONOMY_COMMANDS = [
  { name: "balance <userId>", desc: "用户余额" },
  { name: "transactions <userId>", desc: "用户交易记录(--n --offset)" },
];
const MODERATION_COMMANDS = [
  { name: "list", desc: "玩家管理列表(--type)" },
  { name: "create <type> <userId>", desc: "创建玩家管理(如 mute/block <userId>)" },
  { name: "unmoderate <type> <userId>", desc: "解除玩家管理" },
  { name: "report <reportedUserId>", desc: "举报用户" },
];
const INVITE_COMMANDS = [
  { name: "invite <userId> <worldId> <instanceId>", desc: "邀请用户到实例" },
  { name: "request <userId>", desc: "请求加入对方所在实例" },
  { name: "join <worldId> <instanceId>", desc: "自己加入实例" },
  { name: "respond <notificationId> <yes|no>", desc: "响应邀请" },
];
const MESSAGES_COMMANDS = [
  { name: "list <userId> <type>", desc: "快捷消息列表(type: message/response/request/requestResponse)" },
  { name: "get <userId> <type> <slot>", desc: "获取槽位快捷消息" },
  { name: "update <userId> <type> <slot> <text>", desc: "更新槽位快捷消息" },
];
const OPTIONS = [
  { flag: "--auth-path <path>", desc: "登录态存储路径(默认平台配置目录)" },
  { flag: "--password <pass>", desc: "login 时直接提供密码(不提示输入)" },
  { flag: "--n <count>", desc: "每页数量(默认 20)" },
  { flag: "--offset <n>", desc: "分页偏移" },
  { flag: "--sort <sort>", desc: "排序方式(如 popularity/created_at)" },
  { flag: "--type <type>", desc: "通知类型过滤(如 friendRequest)" },
  { flag: "--json", desc: "输出 JSON(默认)" },
];

interface CliContext {
  authPath?: string;
  baseUrl?: string;
}

/** 环境变量注入:测试/自定义网关用。 */
function envBaseUrl(): string | undefined {
  const value = process.env.AMECHAN_VRCHAT_BASE_URL;
  return value !== undefined && value !== "" ? value : undefined;
}

function envAuthPath(): string | undefined {
  const value = process.env.AMECHAN_VRCHAT_AUTH_PATH;
  return value !== undefined && value !== "" ? value : undefined;
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const command = args.positionals[0];
  const context: CliContext = {};
  const baseUrl = envBaseUrl();
  if (baseUrl !== undefined) {
    context.baseUrl = baseUrl;
  }
  const authPath = getString(args, "auth-path") ?? envAuthPath();
  if (authPath !== undefined) {
    context.authPath = authPath;
  }

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    printHelp(USAGE, COMMANDS, OPTIONS);
    return;
  }

  switch (command) {
    case "login":
      await runLogin(context, args);
      break;
    case "status":
      await runStatus(context);
      break;
    case "logout":
      await runLogout(context);
      break;
    case "users":
      await runUsers(context, args);
      break;
    case "worlds":
      await runWorlds(context, args);
      break;
    case "avatars":
      await runAvatars(context, args);
      break;
    case "instances":
      await runInstances(context, args);
      break;
    case "friends":
      await runFriends(context, args);
      break;
    case "notifications":
      await runNotifications(context, args);
      break;
    case "favorites":
      await runFavorites(context, args);
      break;
    case "groups":
      await runGroups(context, args);
      break;
    case "files":
      await runFiles(context, args);
      break;
    case "permissions":
      await runPermissions(context, args);
      break;
    case "system":
      await runSystem(context, args);
      break;
    case "economy":
      await runEconomy(context, args);
      break;
    case "moderation":
      await runModeration(context, args);
      break;
    case "invite":
      await runInvite(context, args);
      break;
    case "messages":
      await runMessages(context, args);
      break;
    default:
      outputError(`Unknown command: ${command}`);
      printHelp(USAGE, COMMANDS, OPTIONS);
      process.exitCode = 1;
  }
}

/** 创建客户端(统一 authPath/baseUrl 注入)。 */
async function makeClient(context: CliContext): Promise<ReturnType<typeof createVrchatClient>> {
  return createVrchatClient({
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
    ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
  });
}

/** 分页参数。 */
function pageParams(args: ReturnType<typeof parseArgs>) {
  const n = getString(args, "n");
  const offset = getString(args, "offset");
  return {
    ...(n !== undefined ? { n: Number(n) } : {}),
    ...(offset !== undefined ? { offset: Number(offset) } : {}),
  };
}

async function runUsers(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat users <subcommand>", USERS_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "get": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat users get <userId>");
        }
        outputJson(await client.users.getById(id));
        return;
      }
      case "profile": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat users profile <userId>");
        }
        outputJson(await client.users.getProfile(id));
        return;
      }
      case "search": {
        const query = args.positionals[2];
        if (query === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少搜索词,用法: amechan-vrchat users search <query>");
        }
        const list = await client.users.search({ search: query, ...pageParams(args) });
        outputJson({ count: list.length, users: list.map(pickUser) });
        return;
      }
      case "friend-status": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat users friend-status <userId>");
        }
        outputJson(await client.users.getFriendStatus(id));
        return;
      }
      case "worlds": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat users worlds <userId>");
        }
        const list = await client.users.getUserWorlds(id, pageParams(args));
        outputJson({ count: list.length, worlds: list.map(pickWorld) });
        return;
      }
      case "groups": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat users groups <userId>");
        }
        const list = await client.users.getGroups(id);
        outputJson({ count: list.length, groups: list.map(pickGroup) });
        return;
      }
      case "mutuals": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat users mutuals <userId>");
        }
        const list = await client.users.getMutuals(id);
        outputJson({ count: list.length, users: list.map(pickUser) });
        return;
      }
      case "avatar": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat users avatar <userId>");
        }
        outputJson(await client.users.getAvatar(id));
        return;
      }
      case "active": {
        const list = await client.users.listActive(pageParams(args));
        outputJson({ count: list.length, users: list.map(pickUser) });
        return;
      }
      case "update-status": {
        const text = args.positionals.slice(2).join(" ");
        if (text === "") {
          throw new VrchatError("NOT_FOUND", "缺少状态文本,用法: amechan-vrchat users update-status <text>");
        }
        const me = await client.auth.currentUser();
        const updated = await client.users.updateCurrent(me.id, { statusDescription: text });
        outputJson({ ok: true, statusDescription: updated.statusDescription });
        return;
      }
      case "update-bio": {
        const text = args.positionals.slice(2).join(" ");
        if (text === "") {
          throw new VrchatError("NOT_FOUND", "缺少简介内容,用法: amechan-vrchat users update-bio <text>");
        }
        const me = await client.auth.currentUser();
        const updated = await client.users.updateCurrent(me.id, { bio: text });
        outputJson({ ok: true, bio: updated.bio });
        return;
      }
      default:
        outputError(`Unknown subcommand: users ${sub}`);
        printHelp("amechan-vrchat users <subcommand>", USERS_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runWorlds(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat worlds <subcommand>", WORLDS_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "get": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少世界 ID,用法: amechan-vrchat worlds get <worldId>");
        }
        outputJson(await client.worlds.getById(id));
        return;
      }
      case "search": {
        const query = args.positionals[2];
        if (query === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少搜索词,用法: amechan-vrchat worlds search <query>");
        }
        const sort = getString(args, "sort");
        const list = await client.worlds.search({
          search: query,
          ...pageParams(args),
          ...(sort !== undefined ? { sort: sort as never } : {}),
        });
        outputJson({ count: list.length, worlds: list.map(pickWorld) });
        return;
      }
      case "publish": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少世界 ID,用法: amechan-vrchat worlds publish <worldId>");
        }
        const world = await client.worlds.publish(id);
        outputJson({ ok: true, worldId: world.id, publicationStatus: world.publicationStatus });
        return;
      }
      case "favorites": {
        const list = await client.worlds.listFavorites(pageParams(args));
        outputJson({ count: list.length, worlds: list.map(pickWorld) });
        return;
      }
      case "recent": {
        const list = await client.worlds.listRecent(pageParams(args));
        outputJson({ count: list.length, worlds: list.map(pickWorld) });
        return;
      }
      case "active": {
        const list = await client.worlds.listActive(pageParams(args));
        outputJson({ count: list.length, worlds: list.map(pickWorld) });
        return;
      }
      case "add-tags": {
        const id = args.positionals[2];
        const tag = args.positionals[3];
        if (id === undefined || tag === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat worlds add-tags <worldId> <tag>");
        }
        const world = await client.worlds.addTags(id, [tag]);
        outputJson({ ok: true, worldId: world.id });
        return;
      }
      case "remove-tags": {
        const id = args.positionals[2];
        const tag = args.positionals[3];
        if (id === undefined || tag === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat worlds remove-tags <worldId> <tag>");
        }
        const world = await client.worlds.removeTags(id, [tag]);
        outputJson({ ok: true, worldId: world.id });
        return;
      }
      default:
        outputError(`Unknown subcommand: worlds ${sub}`);
        printHelp("amechan-vrchat worlds <subcommand>", WORLDS_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runAvatars(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat avatars <subcommand>", AVATARS_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "get": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少头像 ID,用法: amechan-vrchat avatars get <avatarId>");
        }
        outputJson(await client.avatars.getById(id));
        return;
      }
      case "search": {
        const query = args.positionals[2];
        if (query === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少搜索词,用法: amechan-vrchat avatars search <query>");
        }
        const list = await client.avatars.search({ search: query, ...pageParams(args) });
        outputJson({ count: list.length, avatars: list.map(pickAvatar) });
        return;
      }
      case "owned": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat avatars owned <userId>");
        }
        const list = await client.avatars.listOwned(id);
        outputJson({ count: list.length, avatars: list.map(pickAvatar) });
        return;
      }
      case "select": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少头像 ID,用法: amechan-vrchat avatars select <avatarId>");
        }
        const me = await client.avatars.selectCurrent(id);
        outputJson({ ok: true, avatarId: me.avatarId });
        return;
      }
      case "favorites": {
        const list = await client.avatars.listFavorites(pageParams(args));
        outputJson({ count: list.length, avatars: list.map(pickAvatar) });
        return;
      }
      case "licensed": {
        const list = await client.avatars.listLicensed(pageParams(args));
        outputJson({ count: list.length, avatars: list.map(pickAvatar) });
        return;
      }
      case "styles": {
        const styles = await client.avatars.getStyles();
        outputJson({ count: styles.length, styles });
        return;
      }
      default:
        outputError(`Unknown subcommand: avatars ${sub}`);
        printHelp("amechan-vrchat avatars <subcommand>", AVATARS_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runInstances(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat instances <subcommand>", INSTANCES_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "get": {
        const worldId = args.positionals[2];
        const instanceId = args.positionals[3];
        if (worldId === undefined || instanceId === undefined) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat instances get <worldId> <instanceId>",
          );
        }
        outputJson(await client.instances.getById(worldId, instanceId));
        return;
      }
      case "short-name": {
        const worldId = args.positionals[2];
        const instanceId = args.positionals[3];
        if (worldId === undefined || instanceId === undefined) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat instances short-name <worldId> <instanceId>",
          );
        }
        outputJson(await client.instances.getShortName(worldId, instanceId));
        return;
      }
      case "recent": {
        const list = await client.instances.listRecent(pageParams(args));
        outputJson({ count: list.length, instances: list });
        return;
      }
      default:
        outputError(`Unknown subcommand: instances ${sub}`);
        printHelp("amechan-vrchat instances <subcommand>", INSTANCES_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runFriends(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat friends <subcommand>", FRIENDS_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "list": {
        const list = await client.friends.list(pageParams(args));
        outputJson({ count: list.length, friends: list.map(pickUser) });
        return;
      }
      case "online": {
        const list = await client.friends.online();
        // 解析在线好友所在世界名(并发受限,世界 id 去重)
        const worldIds = [
          ...new Set(
            list
              .map((f) => FriendsApi.worldIdOf(f))
              .filter((id): id is string => id !== undefined),
          ),
        ];
        const names = new Map<string, string>();
        let i = 0;
        async function worker(): Promise<void> {
          while (true) {
            const idx = i++;
            const id = worldIds[idx];
            if (id === undefined) return;
            try {
              const world = await client.worlds.getById(id);
              names.set(id, world.name);
            } catch {
              names.set(id, id);
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(6, worldIds.length) }, () => worker()));
        const friends = list.map((f) => {
          const wid = FriendsApi.worldIdOf(f);
          return {
            id: f.id,
            displayName: f.displayName,
            location: f.location,
            worldId: wid,
            ...(wid !== undefined ? { worldName: names.get(wid) ?? wid } : {}),
          };
        });
        outputJson({ count: friends.length, friends });
        return;
      }
      case "add": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat friends add <userId>");
        }
        const result = await client.friends.sendRequest(id);
        outputJson({ ok: true, message: result.success.message });
        return;
      }
      case "remove": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat friends remove <userId>");
        }
        const result = await client.friends.delete(id);
        outputJson({ ok: true, message: result.success.message });
        return;
      }
      default:
        outputError(`Unknown subcommand: friends ${sub}`);
        printHelp("amechan-vrchat friends <subcommand>", FRIENDS_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runNotifications(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat notifications <subcommand>", NOTIFICATIONS_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "list": {
        const type = getString(args, "type");
        const list = await client.notifications.list({
          ...pageParams(args),
          ...(type !== undefined ? { type: type as never } : {}),
        });
        outputJson({ count: list.length, notifications: list.map(pickNotification) });
        return;
      }
      case "get": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少通知 ID,用法: amechan-vrchat notifications get <notificationId>");
        }
        outputJson(await client.notifications.getById(id));
        return;
      }
      case "accept": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少通知 ID,用法: amechan-vrchat notifications accept <notificationId>");
        }
        const updated = await client.notifications.accept(id);
        outputJson({ ok: true, id: updated.id, type: updated.type });
        return;
      }
      case "hide": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少通知 ID,用法: amechan-vrchat notifications hide <notificationId>");
        }
        const updated = await client.notifications.hide(id);
        outputJson({ ok: true, id: updated.id, type: updated.type });
        return;
      }
      case "see": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少通知 ID,用法: amechan-vrchat notifications see <notificationId>");
        }
        const updated = await client.notifications.markSeen(id);
        outputJson({ ok: true, id: updated.id, type: updated.type });
        return;
      }
      case "reply": {
        const id = args.positionals[2];
        const message = args.positionals.slice(3).join(" ");
        if (id === undefined || message === "") {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat notifications reply <notificationId> <message>");
        }
        const updated = await client.notifications.reply(id, message);
        outputJson({ ok: true, id: updated.id, type: updated.type });
        return;
      }
      case "clear": {
        const result = await client.notifications.clear();
        outputJson({ ok: true, message: result.success.message });
        return;
      }
      default:
        outputError(`Unknown subcommand: notifications ${sub}`);
        printHelp("amechan-vrchat notifications <subcommand>", NOTIFICATIONS_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

/** 精简用户输出字段。 */
function pickUser(user: { id: string; username: string; displayName: string; state?: string }): {
  id: string;
  username: string;
  displayName: string;
  state?: string;
} {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    ...(user.state !== undefined ? { state: user.state } : {}),
  };
}

async function runFavorites(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat favorites <subcommand>", FAVORITES_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "list": {
        const type = getString(args, "type");
        const list = await client.favorites.list({
          ...pageParams(args),
          ...(type !== undefined ? { type: type as never } : {}),
        });
        outputJson({ count: list.length, favorites: list });
        return;
      }
      case "add": {
        const type = args.positionals[2];
        const favoriteId = args.positionals[3];
        if (type === undefined || favoriteId === undefined) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat favorites add <type> <favoriteId>",
          );
        }
        const result = await client.favorites.add({
          type: type as never,
          favoriteId,
          tags: [`${type}s_1`],
        });
        outputJson({ ok: true, favoriteId: result.id });
        return;
      }
      case "remove": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少收藏 ID,用法: amechan-vrchat favorites remove <favoriteId>");
        }
        const result = await client.favorites.remove(id);
        outputJson({ ok: true, message: result.success.message });
        return;
      }
      case "groups": {
        const type = args.positionals[2] ?? "avatar";
        const groups = await client.favorites.listGroups(type as never);
        outputJson({ count: groups.length, groups });
        return;
      }
      case "by-group": {
        const type = args.positionals[2];
        const groupName = args.positionals[3];
        const userId = args.positionals[4];
        if (type === undefined || groupName === undefined || userId === undefined) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat favorites by-group <type> <groupName> <userId>",
          );
        }
        const list = await client.favorites.getByGroup(type as never, groupName, userId, pageParams(args));
        outputJson({ count: list.length, favorites: list });
        return;
      }
      default:
        outputError(`Unknown subcommand: favorites ${sub}`);
        printHelp("amechan-vrchat favorites <subcommand>", FAVORITES_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

function pickWorld(world: { id: string; name: string; authorName: string; capacity: number }): {
  id: string;
  name: string;
  authorName: string;
  capacity: number;
} {
  return { id: world.id, name: world.name, authorName: world.authorName, capacity: world.capacity };
}

async function runGroups(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat groups <subcommand>", GROUPS_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "get": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少群组 ID,用法: amechan-vrchat groups get <groupId>");
        }
        outputJson(await client.groups.getById(id));
        return;
      }
      case "search": {
        const query = args.positionals[2];
        if (query === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少搜索词,用法: amechan-vrchat groups search <query>");
        }
        const list = await client.groups.search({ search: query, ...pageParams(args) });
        outputJson({ count: list.length, groups: list.map(pickGroup) });
        return;
      }
      case "members": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少群组 ID,用法: amechan-vrchat groups members <groupId>");
        }
        const list = await client.groups.listMembers(id, pageParams(args));
        outputJson({ count: list.length, members: list.map(pickUser) });
        return;
      }
      case "member": {
        const gid = args.positionals[2];
        const uid = args.positionals[3];
        if (gid === undefined || uid === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat groups member <groupId> <userId>");
        }
        outputJson(await client.groups.getMember(gid, uid));
        return;
      }
      case "remove-member": {
        const gid = args.positionals[2];
        const uid = args.positionals[3];
        if (gid === undefined || uid === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat groups remove-member <groupId> <userId>");
        }
        const result = await client.groups.removeMember(gid, uid);
        outputJson({ ok: true, message: result.success.message });
        return;
      }
      case "add-role": {
        const gid = args.positionals[2];
        const uid = args.positionals[3];
        const rid = args.positionals[4];
        if (gid === undefined || uid === undefined || rid === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat groups add-role <groupId> <userId> <roleId>");
        }
        const member = await client.groups.addRoleToMember(gid, uid, rid);
        outputJson({ ok: true, userId: member.id, roleIds: member.roleIds });
        return;
      }
      case "remove-role": {
        const gid = args.positionals[2];
        const uid = args.positionals[3];
        const rid = args.positionals[4];
        if (gid === undefined || uid === undefined || rid === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat groups remove-role <groupId> <userId> <roleId>");
        }
        const member = await client.groups.removeRoleFromMember(gid, uid, rid);
        outputJson({ ok: true, userId: member.id, roleIds: member.roleIds });
        return;
      }
      case "role-templates": {
        const list = await client.groups.listRoleTemplates();
        outputJson({ count: list.length, templates: list.map((t) => ({ id: t.id, name: t.name })) });
        return;
      }
      case "instances": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少群组 ID,用法: amechan-vrchat groups instances <groupId>");
        }
        const list = await client.groups.listInstances(id);
        outputJson({ count: list.length, instances: list });
        return;
      }
      case "permissions": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少群组 ID,用法: amechan-vrchat groups permissions <groupId>");
        }
        const list = await client.groups.listPermissions(id);
        outputJson({ count: list.length, permissions: list });
        return;
      }
      case "requests": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少群组 ID,用法: amechan-vrchat groups requests <groupId>");
        }
        const list = await client.groups.listRequests(id, pageParams(args));
        outputJson({ count: list.length, requests: list.map(pickUser) });
        return;
      }
      case "approve": {
        const gid = args.positionals[2];
        const uid = args.positionals[3];
        if (gid === undefined || uid === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat groups approve <groupId> <userId>");
        }
        const member = await client.groups.approveRequest(gid, uid);
        outputJson({ ok: true, userId: member.id });
        return;
      }
      case "bans": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少群组 ID,用法: amechan-vrchat groups bans <groupId>");
        }
        const list = await client.groups.listBans(id);
        outputJson({ count: list.length, bans: list.map((b) => ({ userId: b.user.id, username: b.user.username, bannedAt: b.bannedAt })) });
        return;
      }
      case "ban": {
        const gid = args.positionals[2];
        const uid = args.positionals[3];
        if (gid === undefined || uid === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat groups ban <groupId> <userId>");
        }
        const ban = await client.groups.banMember(gid, uid);
        outputJson({ ok: true, userId: ban.user.id });
        return;
      }
      case "unban": {
        const gid = args.positionals[2];
        const uid = args.positionals[3];
        if (gid === undefined || uid === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat groups unban <groupId> <userId>");
        }
        const result = await client.groups.unbanMember(gid, uid);
        outputJson({ ok: true, message: result.success.message });
        return;
      }
      case "roles": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少群组 ID,用法: amechan-vrchat groups roles <groupId>");
        }
        const list = await client.groups.listRoles(id);
        outputJson({ count: list.length, roles: list });
        return;
      }
      case "join": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少群组 ID,用法: amechan-vrchat groups join <groupId>");
        }
        const group = await client.groups.join(id);
        outputJson({ ok: true, groupId: group.id });
        return;
      }
      case "leave": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少群组 ID,用法: amechan-vrchat groups leave <groupId>");
        }
        const result = await client.groups.leave(id);
        outputJson({ ok: true, message: result.success.message });
        return;
      }
      case "announcement": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少群组 ID,用法: amechan-vrchat groups announcement <groupId>");
        }
        outputJson(await client.groups.getAnnouncement(id));
        return;
      }
      case "announce": {
        const id = args.positionals[2];
        const message = args.positionals.slice(3).join(" ");
        if (id === undefined || message === "") {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat groups announce <groupId> <message>");
        }
        outputJson(await client.groups.setAnnouncement(id, message));
        return;
      }
      default:
        outputError(`Unknown subcommand: groups ${sub}`);
        printHelp("amechan-vrchat groups <subcommand>", GROUPS_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runFiles(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat files <subcommand>", FILES_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "get": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少文件 ID,用法: amechan-vrchat files get <fileId>");
        }
        outputJson(await client.files.getById(id));
        return;
      }
      case "list": {
        const list = await client.files.list(pageParams(args));
        outputJson({ count: list.length, files: list });
        return;
      }
      case "create": {
        const name = args.positionals[2];
        const mimeType = args.positionals[3];
        const extension = args.positionals[4];
        if (name === undefined || mimeType === undefined || extension === undefined) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat files create <name> <mimeType> <extension>",
          );
        }
        outputJson(await client.files.create({ name, mimeType, extension }));
        return;
      }
      case "create-image": {
        const name = args.positionals[2];
        const mimeType = args.positionals[3];
        const extension = args.positionals[4];
        if (name === undefined || mimeType === undefined || extension === undefined) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat files create-image <name> <mimeType> <extension>",
          );
        }
        outputJson(await client.files.createImage({ name, mimeType, extension }));
        return;
      }
      case "delete": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少文件 ID,用法: amechan-vrchat files delete <fileId>");
        }
        const result = await client.files.delete(id);
        outputJson({ ok: true, message: result.success.message });
        return;
      }
      default:
        outputError(`Unknown subcommand: files ${sub}`);
        printHelp("amechan-vrchat files <subcommand>", FILES_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runPermissions(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat permissions <subcommand>", PERMISSIONS_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "list": {
        const list = await client.permissions.list();
        outputJson({ count: list.length, permissions: list });
        return;
      }
      case "get": {
        const id = args.positionals[2];
        if (id === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少权限 ID,用法: amechan-vrchat permissions get <permissionId>");
        }
        outputJson(await client.permissions.getById(id));
        return;
      }
      default:
        outputError(`Unknown subcommand: permissions ${sub}`);
        printHelp("amechan-vrchat permissions <subcommand>", PERMISSIONS_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

function pickGroup(group: { id: string; name: string; shortCode?: string; memberCount?: number }): {
  id: string;
  name: string;
  shortCode?: string;
  memberCount?: number;
} {
  return {
    id: group.id,
    name: group.name,
    ...(group.shortCode !== undefined ? { shortCode: group.shortCode } : {}),
    ...(group.memberCount !== undefined ? { memberCount: group.memberCount } : {}),
  };
}

async function runSystem(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat system <subcommand>", SYSTEM_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "health":
        outputJson(await client.system.health());
        return;
      case "stats":
        outputJson(await client.system.stats());
        return;
      case "time":
        outputJson(await client.system.time());
        return;
      default:
        outputError(`Unknown subcommand: system ${sub}`);
        printHelp("amechan-vrchat system <subcommand>", SYSTEM_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runEconomy(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat economy <subcommand>", ECONOMY_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "balance": {
        const userId = args.positionals[2];
        if (userId === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat economy balance <userId>");
        }
        outputJson(await client.economy.getBalance(userId));
        return;
      }
      case "transactions": {
        const userId = args.positionals[2];
        if (userId === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat economy transactions <userId>");
        }
        const list = await client.economy.getTransactions(userId, pageParams(args));
        outputJson({ count: list.length, transactions: list });
        return;
      }
      default:
        outputError(`Unknown subcommand: economy ${sub}`);
        printHelp("amechan-vrchat economy <subcommand>", ECONOMY_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runModeration(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat moderation <subcommand>", MODERATION_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "list": {
        const type = getString(args, "type");
        const list = await client.moderation.list(
          type !== undefined ? { type: type as never } : {},
        );
        outputJson({ count: list.length, moderations: list });
        return;
      }
      case "create": {
        const type = args.positionals[2];
        const userId = args.positionals[3];
        if (type === undefined || userId === undefined) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat moderation create <type> <userId>",
          );
        }
        outputJson(await client.moderation.create({ type: type as never, moderated: userId }));
        return;
      }
      case "unmoderate": {
        const type = args.positionals[2];
        const userId = args.positionals[3];
        if (type === undefined || userId === undefined) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat moderation unmoderate <type> <userId>",
          );
        }
        outputJson(await client.moderation.unmoderate({ type: type as never, moderated: userId }));
        return;
      }
      case "report": {
        const reported = args.positionals[2];
        if (reported === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少被举报用户 ID,用法: amechan-vrchat moderation report <reportedUserId>");
        }
        const me = await client.auth.currentUser();
        const result = await client.moderation.report({
          reporterUserId: me.id,
          reportedUserId: reported,
          type: "None",
        });
        outputJson({ ok: true, message: result.success.message });
        return;
      }
      default:
        outputError(`Unknown subcommand: moderation ${sub}`);
        printHelp("amechan-vrchat moderation <subcommand>", MODERATION_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runInvite(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat invite <subcommand>", INVITE_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "invite": {
        const userId = args.positionals[2];
        const worldId = args.positionals[3];
        const instanceId = args.positionals[4];
        if (userId === undefined || worldId === undefined || instanceId === undefined) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat invite invite <userId> <worldId> <instanceId>",
          );
        }
        const result = await client.invite.invite(userId, { worldId, instanceId });
        outputJson({ ok: true, notificationId: result.id, type: result.type });
        return;
      }
      case "request": {
        const userId = args.positionals[2];
        if (userId === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少用户 ID,用法: amechan-vrchat invite request <userId>");
        }
        const result = await client.invite.requestInvite(userId);
        outputJson({ ok: true, notificationId: result.id, type: result.type });
        return;
      }
      case "join": {
        const worldId = args.positionals[2];
        const instanceId = args.positionals[3];
        if (worldId === undefined || instanceId === undefined) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat invite join <worldId> <instanceId>",
          );
        }
        const result = await client.invite.joinSelf(worldId, instanceId);
        outputJson({ ok: true, notificationId: result.id, type: result.type });
        return;
      }
      case "respond": {
        const notificationId = args.positionals[2];
        const response = args.positionals[3];
        if (notificationId === undefined || (response !== "yes" && response !== "no")) {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat invite respond <notificationId> <yes|no>",
          );
        }
        const result = await client.invite.respond(notificationId, response);
        outputJson({ ok: true, notificationId: result.id, type: result.type });
        return;
      }
      default:
        outputError(`Unknown subcommand: invite ${sub}`);
        printHelp("amechan-vrchat invite <subcommand>", INVITE_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

async function runMessages(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1];
  const client = await makeClient(context);
  try {
    if (sub === undefined || sub === "help") {
      printHelp("amechan-vrchat messages <subcommand>", MESSAGES_COMMANDS, OPTIONS);
      return;
    }
    switch (sub) {
      case "list": {
        const userId = args.positionals[2];
        const type = args.positionals[3];
        if (userId === undefined || type === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat messages list <userId> <type>");
        }
        const list = await client.messages.list(userId, type as never);
        outputJson({ count: list.length, messages: list });
        return;
      }
      case "get": {
        const userId = args.positionals[2];
        const type = args.positionals[3];
        const slot = args.positionals[4];
        if (userId === undefined || type === undefined || slot === undefined) {
          throw new VrchatError("NOT_FOUND", "缺少参数,用法: amechan-vrchat messages get <userId> <type> <slot>");
        }
        outputJson(await client.messages.get(userId, type as never, Number(slot)));
        return;
      }
      case "update": {
        const userId = args.positionals[2];
        const type = args.positionals[3];
        const slot = args.positionals[4];
        const text = args.positionals.slice(5).join(" ");
        if (userId === undefined || type === undefined || slot === undefined || text === "") {
          throw new VrchatError(
            "NOT_FOUND",
            "缺少参数,用法: amechan-vrchat messages update <userId> <type> <slot> <text>",
          );
        }
        outputJson(await client.messages.update(userId, type as never, Number(slot), text));
        return;
      }
      default:
        outputError(`Unknown subcommand: messages ${sub}`);
        printHelp("amechan-vrchat messages <subcommand>", MESSAGES_COMMANDS, OPTIONS);
        process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

function pickAvatar(avatar: { id: string; name: string; authorName: string }): {
  id: string;
  name: string;
  authorName: string;
} {
  return { id: avatar.id, name: avatar.name, authorName: avatar.authorName };
}

function pickNotification(n: {
  id: string;
  type: string;
  senderUserId: string;
  created_at: string;
  message?: string;
}): { id: string; type: string; senderUserId: string; createdAt: string; message?: string } {
  return {
    id: n.id,
    type: n.type,
    senderUserId: n.senderUserId,
    createdAt: n.created_at,
    ...(n.message !== undefined ? { message: n.message } : {}),
  };
}

async function runLogin(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const store = new AuthStore({
    platform: "vrchat",
    ...(context.authPath !== undefined ? { path: context.authPath } : {}),
  });
  const username = args.positionals[1] ?? (await prompt("用户名: "));
  const password = getString(args, "password") ?? (await prompt("密码: "));
  if (username === "" || password === "") {
    throw new AccountError("INVALID_CREDENTIALS", "用户名或密码不能为空");
  }

  outputText(`登录态存储: ${store.path}`);
  const client = await createVrchatClient({
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
    ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
  });
  try {
    const result = await client.login({
      username,
      password,
      store,
      onNeedCode: async (info) => {
        outputText(`[2FA] ${info.message}`);
        const code = await prompt("验证码: ");
        return code;
      },
      onStatus: (status) => {
        if (status.state !== "submitting") {
          outputText(`[${status.state}] ${status.message}`);
        }
      },
    });
    if (result.saved) {
      outputJson({ ok: true, message: "登录成功,登录态已保存" });
    } else {
      outputJson({ ok: true, message: "登录成功", credentials: result.credentials });
    }
  } finally {
    await client.close();
  }
}

async function runStatus(context: CliContext): Promise<void> {
  const store = new AuthStore({
    platform: "vrchat",
    ...(context.authPath !== undefined ? { path: context.authPath } : {}),
  });
  const payload = store.loadSync();
  if (payload === null) {
    outputJson({ loggedIn: false, message: "未登录,请运行 amechan-vrchat login" });
    return;
  }
  const cookie = payload.credentials?.authCookie;
  const hasCookie = typeof cookie === "string" && cookie !== "";
  outputJson({
    loggedIn: hasCookie,
    path: store.path,
    savedAt: payload.savedAt,
    ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
  });
}

async function runLogout(context: CliContext): Promise<void> {
  const client = await createVrchatClient({
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
    ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
  });
  try {
    await client.logout();
  } finally {
    await client.close();
  }
  outputJson({ ok: true, message: "已登出" });
}

/** 简单行输入(终端交互)。 */
function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// 直接作为可执行文件运行时才执行(被测试 import 时不触发)。
const isDirectRun =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch {
      return false;
    }
  })();

if (isDirectRun) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof AccountError || error instanceof VrchatError) {
      outputError(`${error.code}: ${error.message}`);
      process.exit(1);
    }
    handleCliError(error);
  });
}

export { main };
export type { CliContext };

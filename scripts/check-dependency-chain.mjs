#!/usr/bin/env node
// 从 registry 读取已发布精确版本；未发布的版本使用本地发布计划。
// 认证来自用户 npm 配置或 CI NODE_AUTH_TOKEN，查询失败时禁止继续。
import { readFileSync } from "node:fs";
import { PACKAGES } from "./packages-list.mjs";
import { createRegistry } from "./registry.mjs";
import { checkDependencyPlan } from "./dependency-plan.mjs";
const manifests = PACKAGES.map(([, directory]) => JSON.parse(readFileSync(`${directory}/package.json`, "utf8")));
const result = checkDependencyPlan(manifests, createRegistry());
console.log(`依赖链检查通过：${result.checked} 个精确版本，${result.pending.length} 个待发布版本`);

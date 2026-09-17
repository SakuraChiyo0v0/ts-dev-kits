import assert from "node:assert/strict";
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { createWebdavBackend, createWebdavConfigCenter } from "@sakurachiyo0v0/config-webdav";
const backend = createWebdavBackend({ url: "http://127.0.0.1:1" });
const center = createConfigCenter({ backend, key: "test-only" });
assert.equal(center.namespace("auth").encrypt, true);
assert.equal(createWebdavConfigCenter({ url: "http://127.0.0.1:1", key: "test-only" }).url, "http://127.0.0.1:1");
// 协议读写在适配包本地 WebDAV 集成测试覆盖；这里验证打包后的公开工厂。

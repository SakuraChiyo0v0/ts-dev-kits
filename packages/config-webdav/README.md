# @sakurachiyo0v0/config-webdav

按需安装的 WebDAV 配置后端及 `sc-config` CLI。依赖 config 核心和 webdav SDK，不依赖 pg。Node.js 20+。

```sh
pnpm add @sakurachiyo0v0/config-webdav
```

```ts
import { createWebdavConfigCenter } from "@sakurachiyo0v0/config-webdav";
const center = createWebdavConfigCenter({
  url: process.env.WEBDAV_URL!,
  username: process.env.WEBDAV_USERNAME!,
  password: process.env.WEBDAV_PASSWORD!,
  key: process.env.CONFIG_KEY!,
});
const remote = center.namespace("auth"); // 可直接传给 AuthStore 或平台 SDK 的 remote
```

- `createWebdavBackend({ url, username?, password? })`：返回 ConfigBackend，可传给 config 的 createConfigCenter。自动沿用原有 WebDAV ConfigStore 的原子写和备份。
- `createWebdavConfigCenter(options?)`：传对象为显式连接配置（另有 key）；传字符串为配置文件路径；省略则加载原有默认配置文件。返回配置中心，附有 url。
- `saveGlobalConfig(config, path?)` / `loadGlobalConfig(path?)` / `clearGlobalConfig(path?)`：本地 WebDAV 配置读写。
- `resolveConfigPath(path?)`：显式路径 > AME_CONFIG_PATH > `<配置根>/amechan/config.json`。
- `resolveConfigRoot`：重导出 config 的平台路径解析。

命名空间默认加密，key 缺省读取 CONFIG_KEY；明文显式设置 encrypt:false。既有 `/amechan/secrets/<namespace>`、`/amechan/configs/<namespace>` 路径和密文格式保持不变。WebDAV 后端将通用冒号前缀转换为目录路径；缺失键抛 code=NOT_FOUND。连接、认证等错误沿用 WebdavError；核心参数错误为 ConfigError，均可按 code 判断。

## CLI

```sh
pnpm exec sc-config setup --url https://dav.example.invalid --key YOUR_LOCAL_KEY
pnpm exec sc-config status
pnpm exec sc-config help
```

`setup/status/get/set/list/remove/clear/help` 命令和参数保持不变；全局安装改为 `npm i -g @sakurachiyo0v0/config-webdav`。全局配置中的密钥仅保存在本机。真实服务器可能要求预先建立命名空间目录。

完整命令见 [config CLI 手册](../../skills/config-cli/SKILL.md)。

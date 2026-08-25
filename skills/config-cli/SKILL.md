# amechan-config CLI

配置中心 CLI:全局配置(WebDAV 地址/账号/密钥)一次设置,各平台/模块通过 `namespace` 存取配置,敏感配置可选加密。

## 环境检查

```bash
amechan-config help    # 查看命令与选项
which amechan-config   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/config`。

## 全局配置(一次性)

```bash
amechan-config setup --url http://dav.amechan.cloud/dav/ --username webdav --password "应用密码" --key "加密密钥"
amechan-config status    # 查看配置状态(密码/密钥脱敏)
amechan-config clear     # 清除本地全局配置
```

- 全局配置写本地 `<配置根>/amechan/config.json`(chmod 600),**密钥不出本机**;换机器只需重新 `setup` 同一份 WebDAV+密钥,即可读取还原各平台配置。
- 密钥也可不写在 setup 里,用环境变量 `WEBDAV_CONFIG_KEY`。

## 配置存取

```bash
# 明文域(普通配置)
amechan-config set bilibili ui --json '{"quality":80}'     # 写 /configs/bilibili/ui
amechan-config get bilibili ui                              # 读
amechan-config list bilibili                                # 列出该域配置名
amechan-config remove bilibili ui                           # 删

# 加密域(敏感配置:登录态/cookie/密钥)加 --encrypt
amechan-config set xiaoheihe auth --json '{"cookie":"SID=..."}' --encrypt   # /secrets/xiaoheihe/auth(密文)
amechan-config get xiaoheihe auth --encrypt                                 # 解密读
```

- 远端目录(`/configs/<ns>`、`/secrets/<ns>`)需预先存在(坚果云禁 WebDAV 建目录,网页端建)。
- 加密域云端只存 AES-256-GCM 密文;密钥丢失则无法解密。

## 错误码

- `VALIDATION`:全局配置缺失/非法、namespace 非法。
- `AUTHENTICATION` / `CONNECTION` / `NOT_FOUND` / `DECRYPTION` / `CONFLICT`:WebDAV 层错误,与 `@sakurachiyo0v0/webdav` 一致,CLI 输出带 `[CODE]`。

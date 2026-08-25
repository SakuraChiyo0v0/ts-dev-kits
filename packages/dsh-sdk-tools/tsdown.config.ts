/**
 * tsdown 构建:dsh-sdk-tools 的 client bundle。
 *
 * host 半仍走原有 tsc(bundle)→ rollup → dist 流程;这里只出浏览器半:
 * `src/client/index.tsx` 打包为 CJS closure factory(`lib/client.js`),
 * 经 `window.__ModuleLoader__.load({id, factory})` 注册,id 与 package.json
 * `name` 一致(client-modules compose 按包名对账)。
 *
 * 模块表(CLIENT_EXTERNALS)只列浏览器共享的 react / cordis;本插件的
 * @deepseek-ai 依赖全部是 type-only(构建期擦除),purity gate 拒绝任何
 * 跨插件值 import——协作走 cordis service(slots / settingsScope)。
 * CSS Modules 编译为哈希类名并注入 <style data-plugin> 标签。
 */
import { readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve as resolvePath, sep } from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "tsdown";
import { transform } from "lightningcss";

/** Node 内置模块绝不允许进浏览器 module table factory。 */
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((id) => `node:${id}`),
]);

/** Web shell 共享进冻结模块表的 specifier。 */
const CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "cordis",
];

const PLUGIN_ID = "@sakurachiyo0v0/dsh-sdk-tools";

/** Virtual-id wrapper,把 module css 与 tsdown 自身 css 管线隔开。 */
const CSS_VIRTUAL_PREFIX = "\0dsh-css:";
const CSS_VIRTUAL_SUFFIX = ".mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL(".", import.meta.url));

/** 注入 <style data-plugin-css> 的前导代码(module css 与普通 css 共用)。 */
function injectTag(pluginId: string, fileId: string, cssText: string): string {
  const tagId = `${pluginId}/${basename(fileId)}`;
  return [
    `const css = ${JSON.stringify(cssText)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    "  tag.dataset.pluginCss = tagId;",
    "  tag.textContent = css;",
    "  document.head.appendChild(tag);",
    "}",
  ].join("\n");
}

/** 把 lib 内物理路径 rebase 成仓库形状的浏览器 URL(调试用 sourcemap)。 */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith(".")) return source;
  const physicalSource = resolvePath(dirname(sourcemapPath), source);
  const repositoryPath = relative(REPOSITORY_ROOT, physicalSource).split(sep).join("/");
  return `../../../${repositoryPath}`;
}

/** 拒绝任何 @deepseek-ai 值 import 的纯度门(type-only 已擦除,到不了这里)。 */
function purityGatePlugin(): NonNullable<UserConfig["plugins"]> {
  return {
    name: "dsh-client-bundle-purity",
    resolveId(source: string) {
      if (NODE_BUILTINS.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table — `
          + "select the dependency browser export or add an explicit browser implementation",
        );
      }
      if (!source.startsWith("@deepseek-ai/")) return null;
      throw new Error(
        `client bundle purity: "${source}" is a platform package — cross-plugin value imports are forbidden; `
        + "collaborate through cordis services (type-only imports are erased and never reach this gate)",
      );
    },
  };
}

/** CSS 内联虚拟模块插件(每个文件注入一个 <style data-plugin>)。 */
function makeCssPlugin(pluginId: string): NonNullable<UserConfig["plugins"]> {
  return {
    name: "dsh-css-inline",
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith(".css")) return null;
      let abs: string;
      if (source.startsWith(".") || source.startsWith("/") || /^[A-Za-z]:[\\/]/.test(source)) {
        abs = importer === undefined ? source : resolvePath(dirname(importer), source);
      } else {
        abs = resolvePath(REPOSITORY_ROOT, "node_modules", source);
      }
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX;
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null;
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length);
      this.addWatchFile(fileId);
      const source = await readFile(fileId);
      if (fileId.endsWith(".module.css")) {
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: "[hash]_[local]" },
          minify: true,
        });
        const classMap: Record<string, string> = {};
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name;
        return [
          injectTag(pluginId, fileId, code.toString()),
          `export default ${JSON.stringify(classMap)};`,
        ].join("\n");
      }
      return [
        injectTag(pluginId, fileId, source.toString("utf8")),
        'export default "";',
      ].join("\n");
    },
  };
}

export default [
  {
    entry: { client: "src/client/index.tsx" },
    outDir: "lib",
    format: "cjs",
    platform: "browser",
    // 类型声明由 tsc(tsconfig.client.json)生成到 lib/,tsdown 只出运行时 bundle。
    dts: false,
    sourcemap: true,
    clean: false,
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
      "import.meta.env.MODE": JSON.stringify(process.env.NODE_ENV ?? "production"),
      "import.meta.env": JSON.stringify({ MODE: process.env.NODE_ENV ?? "production" }),
    },
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
    },
    plugins: [purityGatePlugin(), makeCssPlugin(PLUGIN_ID)],
    outputOptions: {
      entryFileNames: "client.js",
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: "return module.exports; } });",
      intro: "var module = { exports: {} }; var exports = module.exports;",
      codeSplitting: false,
    },
  },
] satisfies UserConfig[];

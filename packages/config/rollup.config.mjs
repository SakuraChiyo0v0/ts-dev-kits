export default {
  input: ".build/index.js",
  external: (id) =>
    id === "webdav" ||
    id === "@sakurachiyo0v0/webdav" ||
    id === "@sakurachiyo0v0/cli-utils" ||
    id === "@sakurachiyo0v0/logger" ||
    id === "pg" ||
    id.startsWith("node:"),
  output: [
    {
      file: "dist/index.js",
      format: "es",
    },
    {
      file: "dist/index.cjs",
      format: "cjs",
      exports: "named",
    },
  ],
};

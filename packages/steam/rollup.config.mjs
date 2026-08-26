export default {
  input: ".build/index.js",
  external: (id) =>
    id.startsWith("node:") ||
    id === "undici" ||
    id === "@sakurachiyo0v0/account" ||
    id === "@sakurachiyo0v0/logger",
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

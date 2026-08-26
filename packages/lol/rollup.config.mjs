export default {
  input: ".build/index.js",
  external: (id) =>
    id === "@sakurachiyo0v0/logger" ||
    id === "ws" ||
    id === "undici" ||
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

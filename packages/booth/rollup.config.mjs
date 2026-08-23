export default {
  input: ".build/index.js",
  external: (id) =>
    id === "@sakurachiyo0v0/account" ||
    id === "@sakurachiyo0v0/cli-utils" ||
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

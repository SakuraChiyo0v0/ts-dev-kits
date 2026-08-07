export default {
  input: ".build/index.js",
  external: (id) =>
    id === "@larksuiteoapi/node-sdk" || id.startsWith("node:"),
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

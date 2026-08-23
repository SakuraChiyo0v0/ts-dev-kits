export default {
  input: ".build/index.js",
  external: (id) => id.startsWith("node:") || id === "@sakurachiyo0v0/account",
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

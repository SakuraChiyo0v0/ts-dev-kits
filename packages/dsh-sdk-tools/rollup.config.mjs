export default {
  input: ".build/index.js",
  external: (id) =>
    id.startsWith("@sakurachiyo0v0/") || id.startsWith("@deepseek-ai/") || id.startsWith("node:"),
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

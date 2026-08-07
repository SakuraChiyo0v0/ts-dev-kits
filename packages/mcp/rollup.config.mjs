export default {
  input: ".build/index.js",
  external: (id) =>
    id === "@amechan/llm" ||
    id === "@modelcontextprotocol/sdk" ||
    id.startsWith("@modelcontextprotocol/sdk/") ||
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

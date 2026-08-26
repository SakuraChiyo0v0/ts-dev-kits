export default {
  input: ".build/index.js",
  output: [
    { file: "dist/index.js", format: "esm" },
    { file: "dist/index.cjs", format: "cjs" },
  ],
  external: (id) => id.startsWith("node:"),
};

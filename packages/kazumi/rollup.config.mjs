export default {
  input: ".build/index.js",
  external: (id) =>
    id.startsWith("node:") ||
    id === "@sakurachiyo0v0/cli-utils" ||
    id === "@sakurachiyo0v0/ffmpeg" ||
    id === "@sakurachiyo0v0/logger" ||
    id === "@xmldom/xmldom" ||
    id === "cheerio" ||
    id === "xpath",
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

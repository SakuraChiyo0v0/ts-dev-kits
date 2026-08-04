export default {
  input: ".build/index.js",
  external: (id) => id.startsWith("node:") || id === "@amechan/ffmpeg",
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

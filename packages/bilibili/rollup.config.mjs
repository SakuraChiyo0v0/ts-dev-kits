export default {
  input: ".build/index.js",
  external: (id) =>
    id === "qrcode" || id === "@sakurachiyo0v0/ffmpeg" || id === "@sakurachiyo0v0/bilibili-auth" || id.startsWith("node:"),
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

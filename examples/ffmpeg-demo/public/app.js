const statusEl = document.getElementById("status");
const fileInput = document.getElementById("file");
const uploadButton = document.getElementById("upload");
const uploadResult = document.getElementById("upload-result");
const codecSelect = document.getElementById("codec");
const transcodeButton = document.getElementById("transcode");
const progressEl = document.getElementById("progress");
const transcodeResult = document.getElementById("transcode-result");

/** 当前已上传、可被转码的服务端文件路径。 */
let activePath = null;

function show(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle("error", isError);
  element.classList.remove("hidden");
}

async function api(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error?.message ?? `Request failed (${response.status})`);
  }
  return data;
}

async function init() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    statusEl.textContent = `FFmpeg 就绪:${data.ffmpegPath} / ffprobe ${data.ffprobePath}`;
  } catch {
    statusEl.textContent = "无法连接演示服务";
  }
}

uploadButton.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    show(uploadResult, "请先选择文件", true);
    return;
  }
  uploadButton.disabled = true;
  show(uploadResult, "上传中…");
  try {
    const data = await file.arrayBuffer();
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: data,
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      throw new Error(result.error?.message ?? `Upload failed (${response.status})`);
    }
    activePath = result.path;
    const info = result.info;
    const lines = [
      `格式:${info.formatName}`,
      `时长:${info.duration.toFixed(2)}s`,
      `大小:${(info.size / 1024).toFixed(1)} KiB`,
    ];
    if (info.videoStream) {
      lines.push(`视频:${info.videoStream.width}×${info.videoStream.height} (${info.videoStream.codecName})`);
    }
    if (info.audioStream) {
      lines.push(`音频:${info.audioStream.codecName}`);
    }
    show(uploadResult, lines.join("\n"));
    transcodeButton.disabled = false;
  } catch (error) {
    show(uploadResult, error.message, true);
    transcodeButton.disabled = true;
  } finally {
    uploadButton.disabled = false;
  }
});

transcodeButton.addEventListener("click", async () => {
  if (!activePath) {
    return;
  }
  transcodeButton.disabled = true;
  progressEl.value = 0;
  show(transcodeResult, "转码中…");
  try {
    const result = await api("/api/transcode", {
      input: activePath,
      videoCodec: codecSelect.value,
    });
    show(transcodeResult, `转码完成:${result.output}`);
  } catch (error) {
    show(transcodeResult, error.message, true);
  } finally {
    transcodeButton.disabled = false;
  }
});

init();

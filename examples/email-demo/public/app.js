const form = document.querySelector("[data-email-form]");
const result = document.querySelector("[data-result]");
const preview = document.querySelector("[data-preview]");
const previewButton = document.querySelector("[data-preview-button]");
const sendButton = document.querySelector("[data-send]");
const verifyButton = document.querySelector("[data-verify]");
const status = document.querySelector("[data-status]");
const attachmentInput = document.querySelector("[data-attachments]");
const attachmentSummary = document.querySelector("[data-attachment-summary]");

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const setResult = (value) => {
  result.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

const escapeHtml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const splitAddresses = (value) =>
  value
    .split(/[;,\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);

const formatBytes = (bytes) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;

async function fileToAttachment(file) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} 超过 5 MiB`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return {
    filename: file.name,
    ...(file.type ? { contentType: file.type } : {}),
    contentBase64: btoa(binary),
  };
}

async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

function field(name) {
  return form.elements.namedItem(name);
}

function showPreview() {
  const html = field("html").value.trim();
  const text = field("text").value;
  preview.srcdoc = html || `<pre>${escapeHtml(text)}</pre>`;
}

attachmentInput.addEventListener("change", () => {
  const files = [...attachmentInput.files];
  const total = files.reduce((sum, file) => sum + file.size, 0);
  attachmentSummary.textContent = files.length
    ? `${files.length} 个文件，共 ${formatBytes(total)}`
    : "单个不超过 5 MiB，总计不超过 10 MiB";
});

previewButton.addEventListener("click", () => {
  showPreview();
  setResult("预览已更新；预览框未获得脚本执行权限。");
});

verifyButton.addEventListener("click", async () => {
  verifyButton.disabled = true;
  setResult("正在验证 SMTP 连接…");
  try {
    await request("/api/verify", {});
    status.textContent = "SMTP 连接可用";
    setResult("SMTP 连接验证成功。");
  } catch (error) {
    status.textContent = "SMTP 连接验证失败";
    setResult(error instanceof Error ? error.message : "验证失败");
  } finally {
    verifyButton.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) {
    return;
  }

  const text = field("text").value;
  const html = field("html").value;
  if (!text.trim() && !html.trim()) {
    setResult("请至少填写纯文本正文或 HTML 正文。");
    field("text").focus();
    return;
  }

  const files = [...attachmentInput.files];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    setResult("附件总大小超过 10 MiB。");
    return;
  }

  previewButton.disabled = true;
  sendButton.disabled = true;
  setResult("正在准备附件并发送…");

  try {
    const attachments = await Promise.all(files.map(fileToAttachment));
    const payload = {
      from: field("from").value.trim(),
      to: splitAddresses(field("to").value),
      cc: splitAddresses(field("cc").value),
      bcc: splitAddresses(field("bcc").value),
      replyTo: splitAddresses(field("replyTo").value),
      subject: field("subject").value.trim(),
      ...(text ? { text } : {}),
      ...(html ? { html } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
    showPreview();
    const response = await request("/api/send", payload);
    setResult(response);
  } catch (error) {
    setResult(error instanceof Error ? error.message : "发送失败");
  } finally {
    previewButton.disabled = false;
    sendButton.disabled = false;
  }
});

async function loadStatus() {
  try {
    const payload = await request("/api/status");
    status.textContent = payload.configured ? "本地 SMTP 已配置" : "SMTP 未配置";
    if (payload.defaultFrom && !field("from").value) {
      field("from").value = payload.defaultFrom;
    }
  } catch (error) {
    status.textContent = "无法读取本地服务状态";
    setResult(error instanceof Error ? error.message : "状态读取失败");
  }
}

void loadStatus();

/**
 * 文件域 —— 上传链路:创建文件 / 开始上传 / 完成上传。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { FileUpload } from "../types.js";

/** 创建文件选项。 */
export interface CreateFileOptions {
  name: string;
  mimeType: string;
  /** 扩展名(带点,如 ".png")。 */
  extension: string;
  /** 上传类型:avatar | world | image | texture。 */
  uploadType?: string;
}

/** 文件版本信息(含上传 URL)。 */
export interface FileVersion {
  id: number;
  sizeInBytes: number;
  status: "waiting" | "complete" | "denied";
  uploadedAt?: string;
  file?: {
    url: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** 上传子资源类型(官方 fileType 参数)。 */
export type UploadFileType = "file" | "image" | "texture" | "unitypackage";

/** 开始上传响应(含目标 URL 与凭证)。 */
export interface UploadStartResult {
  url: string;
  uploadId?: string;
  [key: string]: unknown;
}

/** 完成上传响应。 */
export interface UploadFinishResult {
  etags?: string[];
  version?: FileVersion;
  [key: string]: unknown;
}

export class FilesApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 按 ID 获取文件信息。 */
  async getById(fileId: string): Promise<FileUpload> {
    return this.#transport.request<FileUpload>({
      method: "GET",
      path: `/file/${encodeURIComponent(fileId)}`,
    });
  }

  /** 列出当前用户的所有文件。 */
  async list(options: { n?: number; offset?: number } = {}): Promise<FileUpload[]> {
    return this.#transport.request<FileUpload[]>({
      method: "GET",
      path: "/files",
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 创建图片文件(用于上传图片素材,uploadType 固定为 image)。 */
  async createImage(options: Omit<CreateFileOptions, "uploadType">): Promise<FileUpload> {
    return this.#transport.request<FileUpload>({
      method: "POST",
      path: "/file/image",
      json: {
        name: options.name,
        mimeType: options.mimeType,
        extension: options.extension,
      },
    });
  }

  /** 创建文件,返回文件信息与上传凭证。 */
  async create(options: CreateFileOptions): Promise<FileUpload> {
    return this.#transport.request<FileUpload>({
      method: "POST",
      path: "/file",
      json: {
        name: options.name,
        mimeType: options.mimeType,
        extension: options.extension,
        ...(options.uploadType !== undefined ? { uploadType: options.uploadType } : {}),
      },
    });
  }

  /** 删除文件。 */
  async delete(fileId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "DELETE",
      path: `/file/${encodeURIComponent(fileId)}`,
    });
  }

  /** 开始上传指定版本:返回上传目标 URL(上传大文件走此链路)。 */
  async startUpload(
    fileId: string,
    versionId: number,
    fileType: UploadFileType = "file",
  ): Promise<UploadStartResult> {
    return this.#transport.request<UploadStartResult>({
      method: "PUT",
      path: `/file/${encodeURIComponent(fileId)}/${versionId}/${fileType}/start`,
    });
  }

  /** 完成上传:通知 API 文件已传完,进入审核流程。 */
  async finishUpload(
    fileId: string,
    versionId: number,
    fileType: UploadFileType = "file",
    etags?: string[],
  ): Promise<UploadFinishResult> {
    return this.#transport.request<UploadFinishResult>({
      method: "PUT",
      path: `/file/${encodeURIComponent(fileId)}/${versionId}/${fileType}/finish`,
      ...(etags !== undefined ? { json: { etags } } : {}),
    });
  }

  /** 查询上传状态。 */
  async getUploadStatus(
    fileId: string,
    versionId: number,
    fileType: UploadFileType = "file",
  ): Promise<FileVersion> {
    return this.#transport.request<FileVersion>({
      method: "PUT",
      path: `/file/${encodeURIComponent(fileId)}/${versionId}/${fileType}/status`,
    });
  }
}

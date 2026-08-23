/**
 * workshop 域 —— 创意工坊(ISteamRemoteStorage)。
 * GetPublishedFileDetails 无需 key;Enumerate 系列需 key。
 */
import type { SteamHttpTransport } from "../http.js";
import { SteamEndpoints } from "../endpoints.js";
import { resolveToSteamId64 } from "../internal-resolve.js";
import type { EnumerateFilesResult, SteamIdInput, WorkshopItem } from "../types.js";

export class WorkshopApi {
  constructor(private readonly transport: SteamHttpTransport) {}

  /**
   * 物品详情(GetPublishedFileDetails/v1,无需 key;POST form 数组参数)。
   * 单次最多 100 个,`itemcount` 为数量。
   */
  async getPublishedFileDetails(publishedFileIds: number[]): Promise<WorkshopItem[]> {
    if (publishedFileIds.length === 0) {
      return [];
    }
    const form: Record<string, string | number> = { itemcount: publishedFileIds.length };
    publishedFileIds.forEach((id, index) => {
      form[`publishedfileids[${index}]`] = id;
    });
    const body = await this.transport.request<{
      response: { result: number; resultcount: number; publishedfiledetails?: WorkshopItem[] };
    }>({
      host: "api",
      path: SteamEndpoints.api.publishedFileDetails,
      method: "POST",
      form,
      noCache: true,
    });
    return body.response.publishedfiledetails ?? [];
  }

  /** 用户发布的文件列表(EnumerateUserPublishedFiles/v1,需 key)。 */
  async enumerateUserPublishedFiles(
    steamid: SteamIdInput,
    options: { page?: number } = {},
  ): Promise<EnumerateFilesResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{
      response: {
        total: number;
        publishedfiledetails?: Array<{
          publishedfileid: string;
          filename?: string;
          file_size?: number;
          file_url?: string;
          time_created?: number;
          time_updated?: number;
        }>;
      };
    }>({
      host: "api",
      path: SteamEndpoints.api.enumerateUserPublishedFiles,
      params: {
        steamid: id64,
        ...(options.page !== undefined ? { page: options.page } : {}),
      },
      withKey: true,
    });
    return {
      total: body.response.total,
      files: (body.response.publishedfiledetails ?? []).map((f) => ({
        publishedfileid: f.publishedfileid,
        ...(f.filename !== undefined ? { filename: f.filename } : {}),
        ...(f.file_size !== undefined ? { file_size: f.file_size } : {}),
        ...(f.file_url !== undefined ? { file_url: f.file_url } : {}),
        ...(f.time_created !== undefined ? { time_created: f.time_created } : {}),
        ...(f.time_updated !== undefined ? { time_updated: f.time_updated } : {}),
      })),
    };
  }

  /** 用户订阅的文件列表(EnumerateUserSubscribedFiles/v1,需 key)。 */
  async enumerateUserSubscribedFiles(
    steamid: SteamIdInput,
    options: { page?: number } = {},
  ): Promise<EnumerateFilesResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{
      response: {
        total: number;
        publishedfiledetails?: Array<{
          publishedfileid: string;
          filename?: string;
          file_size?: number;
          file_url?: string;
          time_created?: number;
          time_updated?: number;
        }>;
      };
    }>({
      host: "api",
      path: SteamEndpoints.api.enumerateUserSubscribedFiles,
      params: {
        steamid: id64,
        ...(options.page !== undefined ? { page: options.page } : {}),
      },
      withKey: true,
    });
    return {
      total: body.response.total,
      files: (body.response.publishedfiledetails ?? []).map((f) => ({
        publishedfileid: f.publishedfileid,
        ...(f.filename !== undefined ? { filename: f.filename } : {}),
        ...(f.file_size !== undefined ? { file_size: f.file_size } : {}),
        ...(f.file_url !== undefined ? { file_url: f.file_url } : {}),
        ...(f.time_created !== undefined ? { time_created: f.time_created } : {}),
        ...(f.time_updated !== undefined ? { time_updated: f.time_updated } : {}),
      })),
    };
  }
}

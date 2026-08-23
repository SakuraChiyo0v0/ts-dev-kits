/**
 * 群组域 —— 查询 / 创建 / 成员 / 角色 / 加入离开 / 公告。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { Group, Instance, LimitedUser } from "../types.js";

/** 群组角色。 */
export interface GroupRole {
  id: string;
  name: string;
  description: string;
  isSelfAssignable: boolean;
  permissions: string[];
  [key: string]: unknown;
}

/** 群组角色模板(角色权限预设)。 */
export interface GroupRoleTemplate {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  [key: string]: unknown;
}

/** 群组公告。 */
export interface GroupAnnouncement {
  groupId: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

/** 群组搜索选项。 */
export interface SearchGroupsOptions {
  search?: string;
  n?: number;
  offset?: number;
}

/** 创建群组选项。 */
export interface CreateGroupOptions {
  name: string;
  shortCode?: string;
  description?: string;
  joinState?: "open" | "closed" | "request";
}

/** 群组成员。 */
export interface GroupMember extends LimitedUser {
  roleIds: string[];
  isRepresenting: boolean;
  joinedAt: string;
  [key: string]: unknown;
}

/** 群组封禁记录。 */
export interface GroupBan {
  user: LimitedUser;
  bannedAt: string;
  [key: string]: unknown;
}

export class GroupsApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 按 ID 获取群组。 */
  async getById(groupId: string): Promise<Group> {
    return this.#transport.request<Group>({
      method: "GET",
      path: `/groups/${encodeURIComponent(groupId)}`,
    });
  }

  /** 搜索群组。 */
  async search(options: SearchGroupsOptions = {}): Promise<Group[]> {
    return this.#transport.request<Group[]>({
      method: "GET",
      path: "/groups",
      params: {
        ...(options.search !== undefined ? { search: options.search } : {}),
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 创建群组。 */
  async create(options: CreateGroupOptions): Promise<Group> {
    return this.#transport.request<Group>({
      method: "POST",
      path: "/groups",
      json: {
        name: options.name,
        ...(options.shortCode !== undefined ? { shortCode: options.shortCode } : {}),
        ...(options.description !== undefined ? { description: options.description } : {}),
        ...(options.joinState !== undefined ? { joinState: options.joinState } : {}),
      },
    });
  }

  /** 更新群组。 */
  async update(groupId: string, updates: Partial<CreateGroupOptions>): Promise<Group> {
    return this.#transport.request<Group>({
      method: "PUT",
      path: `/groups/${encodeURIComponent(groupId)}`,
      json: updates,
    });
  }

  /** 删除群组。 */
  async delete(groupId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "DELETE",
      path: `/groups/${encodeURIComponent(groupId)}`,
    });
  }

  /** 群组成员列表。 */
  async listMembers(
    groupId: string,
    options: { n?: number; offset?: number; sort?: string } = {},
  ): Promise<GroupMember[]> {
    return this.#transport.request<GroupMember[]>({
      method: "GET",
      path: `/groups/${encodeURIComponent(groupId)}/members`,
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
        ...(options.sort !== undefined ? { sort: options.sort } : {}),
      },
    });
  }

  /** 单个群组成员详情。 */
  async getMember(groupId: string, userId: string): Promise<GroupMember> {
    return this.#transport.request<GroupMember>({
      method: "GET",
      path: `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
    });
  }

  /** 从群组移除成员。 */
  async removeMember(groupId: string, userId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "DELETE",
      path: `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
    });
  }

  /** 给成员分配群组角色。 */
  async addRoleToMember(
    groupId: string,
    userId: string,
    groupRoleId: string,
  ): Promise<GroupMember> {
    return this.#transport.request<GroupMember>({
      method: "PUT",
      path: `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(groupRoleId)}`,
    });
  }

  /** 移除成员的群组角色。 */
  async removeRoleFromMember(
    groupId: string,
    userId: string,
    groupRoleId: string,
  ): Promise<GroupMember> {
    return this.#transport.request<GroupMember>({
      method: "DELETE",
      path: `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(groupRoleId)}`,
    });
  }

  /** 群组加入申请列表(群主/管理员)。 */
  async listRequests(
    groupId: string,
    options: { n?: number; offset?: number } = {},
  ): Promise<GroupMember[]> {
    return this.#transport.request<GroupMember[]>({
      method: "GET",
      path: `/groups/${encodeURIComponent(groupId)}/requests`,
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 批准群组加入申请。 */
  async approveRequest(groupId: string, userId: string): Promise<GroupMember> {
    return this.#transport.request<GroupMember>({
      method: "POST",
      path: `/groups/${encodeURIComponent(groupId)}/requests/${encodeURIComponent(userId)}`,
    });
  }

  /** 群组封禁列表。 */
  async listBans(groupId: string): Promise<GroupBan[]> {
    return this.#transport.request<GroupBan[]>({
      method: "GET",
      path: `/groups/${encodeURIComponent(groupId)}/bans`,
    });
  }

  /** 封禁用户(需群组管理权限)。 */
  async banMember(groupId: string, userId: string): Promise<GroupBan> {
    return this.#transport.request<GroupBan>({
      method: "POST",
      path: `/groups/${encodeURIComponent(groupId)}/bans`,
      json: { userId },
    });
  }

  /** 解除封禁。 */
  async unbanMember(groupId: string, userId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "DELETE",
      path: `/groups/${encodeURIComponent(groupId)}/bans/${encodeURIComponent(userId)}`,
    });
  }

  /** 群组角色列表。 */
  async listRoles(groupId: string): Promise<GroupRole[]> {
    return this.#transport.request<GroupRole[]>({
      method: "GET",
      path: `/groups/${encodeURIComponent(groupId)}/roles`,
    });
  }

  /** 群组角色模板(创建角色时可参考的权限预设)。 */
  async listRoleTemplates(): Promise<GroupRoleTemplate[]> {
    return this.#transport.request<GroupRoleTemplate[]>({
      method: "GET",
      path: "/groups/roleTemplates",
    });
  }

  /** 群组实例列表。 */
  async listInstances(groupId: string): Promise<Instance[]> {
    return this.#transport.request<Instance[]>({
      method: "GET",
      path: `/groups/${encodeURIComponent(groupId)}/instances`,
    });
  }

  /** 群组权限列表。 */
  async listPermissions(groupId: string): Promise<string[]> {
    return this.#transport.request<string[]>({
      method: "GET",
      path: `/groups/${encodeURIComponent(groupId)}/permissions`,
    });
  }

  /** 创建群组角色。 */
  async createRole(
    groupId: string,
    options: { name: string; description?: string; permissions?: string[] },
  ): Promise<GroupRole> {
    return this.#transport.request<GroupRole>({
      method: "POST",
      path: `/groups/${encodeURIComponent(groupId)}/roles`,
      json: {
        name: options.name,
        ...(options.description !== undefined ? { description: options.description } : {}),
        ...(options.permissions !== undefined ? { permissions: options.permissions } : {}),
      },
    });
  }

  /** 删除群组角色。 */
  async deleteRole(groupId: string, roleId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "DELETE",
      path: `/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}`,
    });
  }

  /** 加入群组。 */
  async join(groupId: string): Promise<Group> {
    return this.#transport.request<Group>({
      method: "PUT",
      path: `/groups/${encodeURIComponent(groupId)}/join`,
    });
  }

  /** 离开群组。 */
  async leave(groupId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "PUT",
      path: `/groups/${encodeURIComponent(groupId)}/leave`,
    });
  }

  /** 获取群组公告。 */
  async getAnnouncement(groupId: string): Promise<GroupAnnouncement> {
    return this.#transport.request<GroupAnnouncement>({
      method: "GET",
      path: `/groups/${encodeURIComponent(groupId)}/announcement`,
    });
  }

  /** 发布群组公告。 */
  async setAnnouncement(groupId: string, message: string): Promise<GroupAnnouncement> {
    return this.#transport.request<GroupAnnouncement>({
      method: "POST",
      path: `/groups/${encodeURIComponent(groupId)}/announcement`,
      json: { message },
    });
  }
}

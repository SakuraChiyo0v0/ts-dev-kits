import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { v2 } from "webdav-server";

const { WebDAVServer, HTTPBasicAuthentication, SimpleUserManager, VirtualFileSystem } = v2;

/** 获取一个真实空闲的端口(webdav-server 的 startAsync(0) 不会随机) */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** 本地真实 WebDAV 测试服务器(内存文件系统 + Basic 认证),测试自清理 */
export interface TestWebdavServer {
  url: string;
  port: number;
  username: string;
  password: string;
  stop: () => Promise<void>;
}

export async function startTestWebdavServer(): Promise<TestWebdavServer> {
  const username = "testuser";
  const password = "testpass";
  const userManager = new SimpleUserManager();
  userManager.addUser(username, password, true);
  const server = new WebDAVServer({
    rootFileSystem: new VirtualFileSystem(),
    httpAuthentication: new HTTPBasicAuthentication(userManager),
  });
  const port = await getFreePort();
  const httpServer = await server.startAsync(port);
  const actualPort = (httpServer.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${actualPort}/`,
    port: actualPort,
    username,
    password,
    stop: () => server.stopAsync(),
  };
}

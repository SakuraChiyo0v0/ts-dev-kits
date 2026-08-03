import { SMTPServer } from "smtp-server";

export interface TestSmtpServer {
  port: number;
  messages: string[];
  close(): Promise<void>;
}
export async function startTestSmtpServer(auth?: {
  user: string;
  pass: string;
}): Promise<TestSmtpServer> {
  const messages: string[] = [];
  const server = new SMTPServer({
    disabledCommands: ["STARTTLS"],
    authOptional: auth === undefined,
    onAuth(credentials, _session, callback) {
      if (
        auth &&
        credentials.username === auth.user &&
        credentials.password === auth.pass
      ) {
        callback(null, { user: credentials.username });
        return;
      }
      callback(new Error("Invalid username or password"));
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        messages.push(Buffer.concat(chunks).toString("utf8"));
        callback();
      });
      stream.on("error", callback);
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("SMTP server has no TCP address");
  }

  return {
    port: address.port,
    messages,
    close: () => new Promise<void>((resolve) => server.close(resolve)),
  };
}

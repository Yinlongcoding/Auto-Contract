import { request } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 5173;
const projectMarker = "<title>外贸单据生成器</title>";

function inspectExistingServer() {
  return new Promise((resolve) => {
    const probe = request(
      {
        host,
        port,
        path: "/",
        method: "GET",
        timeout: 1200,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve(body.includes(projectMarker) ? "project" : "other");
        });
      },
    );

    probe.on("timeout", () => {
      probe.destroy();
      resolve("other");
    });
    probe.on("error", (error) => {
      resolve(error.code === "ECONNREFUSED" ? "free" : "other");
    });
    probe.end();
  });
}

const portState = await inspectExistingServer();

if (portState === "project") {
  console.log(`本项目开发服务已在 http://${host}:${port} 运行，直接复用。`);
  process.exit(0);
}

if (portState === "other") {
  console.error(`端口 ${port} 已被其他程序占用，请关闭该程序后重试。`);
  process.exit(1);
}

const viteEntry = new URL("../node_modules/vite/bin/vite.js", import.meta.url);
const vite = spawn(process.execPath, [fileURLToPath(viteEntry)], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
  windowsHide: true,
});

vite.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!vite.killed) vite.kill(signal);
  });
}

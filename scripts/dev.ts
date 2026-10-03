/** Desenvolvimento da interface: `api2mcp ui` com reload (4100) + Vite com HMR (5173). */
import { spawn } from "node:child_process";

const procs = [
  { name: "ui-api", color: 35, cmd: "npx", args: ["tsx", "watch", "src/cli.ts", "ui"] },
  { name: "vite", color: 33, cmd: "npx", args: ["vite", "--config", "ui/vite.config.ts"] },
];

const children = procs.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "1" } });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) =>
    stream.on("data", (d: Buffer) => out.write(d.toString().replace(/^(?=.)/gm, prefix)));
  pipe(child.stdout!, process.stdout);
  pipe(child.stderr!, process.stderr);
  child.on("exit", (code) => console.log(`${prefix}saiu (${code})`));
  return child;
});

const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

import fs from "node:fs";
import path from "node:path";

export function atomicWriteSync(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

export function safeReadFile(filePath: string, fallback = ""): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

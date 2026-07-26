import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function atomicWrite(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, filePath);
}

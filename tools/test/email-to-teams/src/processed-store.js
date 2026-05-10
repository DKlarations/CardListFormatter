import fs from "node:fs/promises";
import path from "node:path";

export async function loadProcessedStore(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const values = JSON.parse(raw);
    return new Set(Array.isArray(values) ? values : []);
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    throw error;
  }
}

export async function saveProcessedStore(filePath, processedIds) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const values = Array.from(processedIds).sort();
  await fs.writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`, "utf8");
}

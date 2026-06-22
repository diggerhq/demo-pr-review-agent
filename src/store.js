import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonlStore {
  constructor(filePath = "data/reviews.jsonl") {
    this.filePath = filePath;
  }

  async append(record) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const entry = {
      time: new Date().toISOString(),
      ...record,
    };
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }
}

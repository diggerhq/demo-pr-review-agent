import { mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ReviewState } from "./types.js";

export class JsonlStore {
  filePath: string;
  stateDir: string;

  constructor(filePath = "data/reviews.jsonl", stateDir = "data/review-state") {
    this.filePath = filePath;
    this.stateDir = stateDir;
  }

  async append(record: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const entry = {
      time: new Date().toISOString(),
      ...record,
    };
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async saveReviewState(state: ReviewState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    await writeFile(this.statePath(state.sessionId), JSON.stringify(state, null, 2), "utf8");
  }

  async getReviewState(sessionId: string): Promise<ReviewState | null> {
    try {
      const raw = await readFile(this.statePath(sessionId), "utf8");
      return JSON.parse(raw) as ReviewState;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private statePath(sessionId: string): string {
    return join(this.stateDir, `${encodeURIComponent(sessionId)}.json`);
  }
}

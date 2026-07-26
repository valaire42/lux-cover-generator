import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const ISSUE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function attemptError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readState(filePath) {
  try {
    const state = JSON.parse(await readFile(filePath, "utf8"));
    if (state.version !== 1 || state.issues === null || typeof state.issues !== "object") {
      throw new Error("generation attempt state must use version 1 and an issues object");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, issues: {} };
    throw attemptError("INVALID_GENERATION_ATTEMPTS", `cannot read generation attempt state: ${error.message}`);
  }
}

export async function recordGenerationAttempt({ filePath, issueId, limit }) {
  if (typeof issueId !== "string" || !ISSUE_ID.test(issueId)) {
    throw attemptError("INVALID_ISSUE_ID", "issue ID must be lowercase letters, numbers, or hyphens");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw attemptError("INVALID_ATTEMPT_LIMIT", "attempt limit must be a positive integer");
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    throw attemptError("GENERATION_ATTEMPT_LOCKED", `generation attempt state is locked: ${error.message}`);
  }
  try {
    const state = await readState(filePath);
    const current = state.issues[issueId] ?? { attempts: 0, status: "active" };
    if (current.attempts >= limit) {
      throw attemptError(
        "GENERATION_ATTEMPT_LIMIT",
        `${issueId} already reached the ${limit}-attempt generation limit`
      );
    }
    const next = { attempts: current.attempts + 1, status: "active" };
    state.issues[issueId] = next;
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, filePath);
    return { issue_id: issueId, ...next, limit };
  } finally {
    await lock.close();
    await unlink(lockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

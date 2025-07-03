import { writeFile } from "fs/promises";
import { resolve } from "path";
import { mkdirSync, existsSync } from "fs";

// Simple logging system
let logMessages: string[] = [];

export function logInfo(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  logMessages.push(logEntry);
  console.log(message); // Keep console output for immediate feedback
}

export function logError(message: string, error?: any) {
  const timestamp = new Date().toISOString();
  const errorDetails = error ? ` - ${error.message || error}` : "";
  const logEntry = `[${timestamp}] ERROR: ${message}${errorDetails}`;
  logMessages.push(logEntry);
  console.error(" ! ", message, error); // Keep console output for immediate feedback
}

export async function saveLogToFile(name: string) {
  const logDir = resolve("scripts/build-logs");

  const logFile = resolve(logDir, `${name}.log`);

  try {
    // Ensure log directory exists
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const logContent = logMessages.join("\n") + "\n";
    await writeFile(logFile, logContent, "utf-8");
    console.log(`Build log saved to: ${logFile}`);
  } catch (error) {
    console.error("Failed to save log file:", error);
  }
}

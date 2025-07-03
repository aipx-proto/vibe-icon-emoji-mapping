import { exec } from "child_process";
import { mkdirSync } from "fs";
import { rm } from "fs/promises";
import { resolve } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const outDir = resolve("dist-icons");

async function main() {
  console.log("Cloning fluentui-system-icons repo (assets only)...");
  // Remove old directory if exists
  try {
    await rm(outDir, { recursive: true });
  } catch {}
  mkdirSync(outDir, { recursive: true });

  // Clone the repository with sparse checkout to get only the assets folder
  const commands = [
    `git clone --filter=blob:none --sparse https://github.com/microsoft/fluentui-system-icons.git ${outDir}`,
    `cd ${outDir} && git sparse-checkout init --cone`,
    `cd ${outDir} && git sparse-checkout set assets`,
    `cd ${outDir} && git rev-parse HEAD`,
  ];

  let stdout = "";
  for (const command of commands) {
    console.log(`$ ${command}`);
    const { stdout: commandStdout } = await execAsync(command);
    stdout = commandStdout;
  }

  // Remove the .git directory to clean up
  await rm(resolve(outDir, ".git"), { recursive: true });

  console.log("Repo cloned and cleaned up. Assets are ready in dist-icons/assets");
}

main().catch((err) => {
  console.error("Error cloning repo:", err);
  process.exit(1);
});
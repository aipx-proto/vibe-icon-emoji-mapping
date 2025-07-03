import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { resolve, extname, basename } from "path";
import { existsSync, readFileSync } from "fs";
import { config } from "dotenv";
import { OpenAI } from "openai";
import { from, mergeMap, lastValueFrom } from "rxjs";
import { updateProgress } from "../utils/progress-bar";
import { logError, saveLogToFile } from "../utils/simple-build-log";
import type { MetadataEntry } from "../../typings/icon-index";
import { createFewShotExamples, createUserMessage } from "./create-examples";
import type { EmojiAssignmentResponse, EmojiAssignment, NamedIconGroup, GroupAssignmentResult } from "./types";
import { groupIconSets } from "./group-icon-sets";

const systemPromptMd = readFileSync(resolve("scripts", "icon-to-emoji-llm", "systemPrompt.md"), "utf-8");

// Load environment variables from specific file
const envFile = process.argv[2] || ".env.aoai";
config({ path: resolve(envFile) });

const pngDir = resolve("pngs");
const publicDir = resolve("public");
const emojiGroupsDir = resolve("scripts", "icon-to-emoji-llm", "emoji-groups");
const outputFile = resolve("scripts", "icon-to-emoji-llm", "emoji-assignments.json");

const fewShotExamples = await createFewShotExamples(pngDir);

// Azure OpenAI configuration
const azureOpenAI = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_MODEL}`,
  defaultQuery: { "api-version": "2024-02-15-preview" },
  defaultHeaders: {
    "api-key": process.env.AZURE_OPENAI_API_KEY,
  },
});

main();

async function main() {
  const startTime = Date.now();

  console.log("Starting emoji assignment process...");
  console.log(`Loading credentials from: ${envFile}`);

  // Validate environment variables
  if (!process.env.AZURE_OPENAI_API_KEY || !process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_MODEL) {
    console.error(`Missing required environment variables. Please check your ${envFile} file.`);
    console.error("Required variables: AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_MODEL");
    console.error(`\nCreate ${envFile} with your Azure OpenAI credentials:`);
    console.error("AZURE_OPENAI_API_KEY=your_api_key");
    console.error("AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com");
    console.error("AZURE_OPENAI_MODEL=your_deployment_name");
    process.exit(1);
  }

  // Check if PNG directory exists
  if (!existsSync(pngDir)) {
    console.error(`PNG directory not found: ${pngDir}`);
    console.error("Please run 'npm run svg-to-png' first to generate PNG files.");
    process.exit(1);
  }

  // Create emoji-groups directory if it doesn't exist
  await mkdir(emojiGroupsDir, { recursive: true });

  console.log("Scanning for PNG files...");
  const allPngFiles = await getPngFiles();

  if (allPngFiles.length === 0) {
    console.log("No PNG files found for emoji assignment.");
    return;
  }

  // Group icons by the first word of their filename
  const allIconGroups = groupIconSets(allPngFiles);

  // Filter out groups that have already been processed
  const { pendingGroups, existingGroups } = await filterProcessedGroups(allIconGroups);

  const totalIcons = allIconGroups.reduce((sum, group) => sum + group.files.length, 0);
  const pendingIcons = pendingGroups.reduce((sum, group) => sum + group.files.length, 0);
  const existingIcons = existingGroups.reduce((sum, group) => sum + group.assignments.length, 0);

  console.log(`Found ${allPngFiles.length} PNG files total, grouped into ${allIconGroups.length} groups`);
  console.log(`${existingGroups.length} groups already processed (${existingIcons} icons)`);
  console.log(`${pendingGroups.length} groups pending (${pendingIcons} icons)`);

  if (pendingGroups.length === 0) {
    console.log("All groups have been processed! Aggregating results...");
    await aggregateResults(allIconGroups);
    return;
  }

  let progress = existingIcons; // Start with already processed icons
  let errors = 0;
  const newAssignments: EmojiAssignment[] = [];

  const analysis$ = from(pendingGroups).pipe(
    mergeMap(async (iconGroup) => {
      try {
        const groupAssignments = await assignEmojiToIcons(iconGroup);
        if (!groupAssignments) {
          throw new Error(`Failed to assign emojis for group ${iconGroup.name}`);
        }
        await saveGroupResult(iconGroup.name, groupAssignments);
        newAssignments.push(...groupAssignments);
        progress += iconGroup.files.length;
      } catch (error) {
        logError(`Failed to assign emojis for group ${iconGroup.name}`, error);
        errors += iconGroup.files.length;
        progress += iconGroup.files.length;
      }
      updateProgress(progress, totalIcons, "Analyzing icon groups for emoji assignment", errors);
    }, 2) // Process 2 groups concurrently to avoid rate limits
  );

  await lastValueFrom(analysis$);

  // Aggregate all results (existing + new)
  await aggregateResults(allIconGroups);

  console.log(`\nEmoji assignment completed!`);
  console.log(`Successfully processed ${newAssignments.length} new icons.`);
  console.log(`Total icons processed: ${progress - errors} / ${totalIcons}`);
  if (errors > 0) {
    console.log(`${errors} files failed to process.`);
  }
  console.log(`Results saved to: ${outputFile}`);

  // Save the build log
  saveLogToFile("emoji-assignment");

  const endTime = Date.now();
  const elapsedSeconds = ((endTime - startTime) / 1000).toFixed(2);
  console.log(`Total time elapsed: ${elapsedSeconds} seconds`);
}

async function filterProcessedGroups(iconGroups: NamedIconGroup[]): Promise<{
  pendingGroups: NamedIconGroup[];
  existingGroups: GroupAssignmentResult[];
}> {
  const pendingGroups: NamedIconGroup[] = [];
  const existingGroups: GroupAssignmentResult[] = [];

  for (const group of iconGroups) {
    const groupFilePath = resolve(emojiGroupsDir, `${group.name}.json`);

    if (existsSync(groupFilePath)) {
      try {
        const content = await readFile(groupFilePath, "utf-8");
        if (content.includes("n/a")) {
          // || group.name.includes("-extras")) {
          unlink(groupFilePath);
          throw new Error(`Group file ${group.name}.json contains n/a assignments`);
        }
        const result = JSON.parse(content) as GroupAssignmentResult;
        existingGroups.push(result);
        console.log(` > Skipping already processed group: ${group.name} (${result.assignments.length} icons)`);
      } catch (error) {
        logError(` > Failed to read existing group file ${group.name}.json, will reprocess`, error);
        pendingGroups.push(group);
      }
    } else {
      pendingGroups.push(group);
    }
  }

  return { pendingGroups, existingGroups };
}

async function saveGroupResult(groupName: string, assignments: EmojiAssignment[]): Promise<void> {
  const result: GroupAssignmentResult = {
    groupName,
    generated: new Date().toISOString(),
    assignments: assignments.sort((a, b) => a.filename?.localeCompare(b.filename) || 0),
  };

  const groupFilePath = resolve(emojiGroupsDir, `${groupName}.json`);
  await writeFile(groupFilePath, JSON.stringify(result, null, 2), "utf-8");
  console.log(` > Saved group result: ${groupName} (${assignments.length} icons)`);
}

async function aggregateResults(allIconGroups: NamedIconGroup[]): Promise<void> {
  const allAssignments: EmojiAssignment[] = [];

  for (const group of allIconGroups) {
    const groupFilePath = resolve(emojiGroupsDir, `${group.name}.json`);

    if (existsSync(groupFilePath)) {
      try {
        const content = await readFile(groupFilePath, "utf-8");
        const result = JSON.parse(content) as GroupAssignmentResult;
        allAssignments.push(...result.assignments);
      } catch (error) {
        logError(`Failed to read group file ${group.name}.json during aggregation`, error);
      }
    }
  }

  // Sort by filename
  const sortedAssignments = allAssignments.sort((a, b) => a.filename?.localeCompare(b.filename) || 0);

  const output = {
    generated: new Date().toISOString(),
    total: allAssignments.length,
    assignments: sortedAssignments,
  };

  await writeFile(outputFile, JSON.stringify(output, null, 2), "utf-8");
  console.log(`Aggregated ${allAssignments.length} assignments to ${outputFile}`);
}

async function assignEmojiToIcons(iconGroup: NamedIconGroup): Promise<EmojiAssignment[] | null> {
  // Create user messages for each icon in the group
  const userMessages = [];
  const iconMetadata: { filename: string; name: string; metaphor: string[] }[] = [];

  for (const pngFilePath of iconGroup.files) {
    const filename = basename(pngFilePath, ".png");
    const { name, metaphor } = await readIconMetadata(filename);

    iconMetadata.push({ filename, name, metaphor });
    const userMessage = await createUserMessage({ filename, name, metaphor }, pngDir);
    userMessages.push(userMessage);
  }

  try {
    const response = await azureOpenAI.chat.completions.create(
      {
        model: process.env.AZURE_OPENAI_MODEL!,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          ...fewShotExamples,
          ...userMessages,
          {
            role: "user",
            content: `Please assign emojis to all ${iconGroup.files.length} icons. Don't skip any icons.`
          }
        ],
        max_tokens: 2000, // Increased for multiple icons
        temperature: 0.2,
      },
      {
        timeout: 30000, // 30 seconds timeout for groups
      }
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response content received");
    }

    // Parse the JSON response - expecting an array of assignments
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("No JSON array found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as EmojiAssignmentResponse[];

    if (parsed.length !== userMessages.length) {
      throw new Error(
        `Parsed response length (${parsed.length}) does not match user message length (${userMessages.length})`
      );
    }

    // Combine the parsed responses with metadata
    return parsed.map((assignment, index) => ({
      ...iconMetadata[index],
      ...assignment,
      subEmoji: assignment.subEmoji || "",
    }));
  } catch (error) {
    logError(`Failed to get AI response for group ${iconGroup.name}`, error);
    if (error instanceof Error && error.message.includes("rate limit")) {
      const retrySeconds = parseInt(error.message.match(/(\d+) seconds/)?.[1] || "30");
      console.log(` > Rate limit exceeded for group ${iconGroup.name}, will retry after ${retrySeconds} seconds`);
      await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
      return assignEmojiToIcons(iconGroup);
    } else {
      return null;
    }
  }
}

async function getPngFiles(): Promise<string[]> {
  try {
    const files = await readdir(pngDir);
    return files.filter((file) => extname(file) === ".png").map((file) => resolve(pngDir, file));
  } catch (error) {
    console.error("Failed to read PNG directory:", error);
    return [];
  }
}

async function readIconMetadata(name: string): Promise<{ name: string; metaphor: string[] }> {
  const metadataPath = resolve(publicDir, `${name}.metadata.json`);

  try {
    const metadataContent = await readFile(metadataPath, "utf-8");
    const metadata: MetadataEntry = JSON.parse(metadataContent);

    return {
      name: metadata.name || name,
      metaphor: metadata.metaphor || [],
    };
  } catch (error) {
    logError(`Could not read metadata for ${name}, using filename as name`);
    return {
      name,
      metaphor: [],
    };
  }
}

const exampleResponse: EmojiAssignmentResponse = {
  emoji: "📄",
  subEmoji: "➕",
  alternativeEmojis: ["📃"],
  similarity: 0.89,
};

const systemPrompt =
  systemPromptMd +
  "\n\nExample response format:\n\n" +
  "```json\n" +
  "[\n" +
  JSON.stringify(exampleResponse, null, 2) +
  "\n]" +
  "\n```";

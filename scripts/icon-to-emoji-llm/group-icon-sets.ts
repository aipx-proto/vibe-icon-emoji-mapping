import { writeFile } from "fs/promises";
import { basename, resolve } from "path";
import type { NamedIconGroup } from "./types";

function generateGroupName(files: string[], baseWord: string, index?: number): string {
  // Start with the base word (first word)
  let groupName = baseWord;

  // If this is a subgroup (index provided), add distinguishing information
  if (index !== undefined) {
    // Try to find a common second word or pattern
    const secondWords = files.map((f) => basename(f, ".png").split(/[-_]/)[1]).filter((w) => w && w !== "__none__");

    if (secondWords.length > 0) {
      // Get most common second word
      const wordCounts = secondWords.reduce((acc, word) => {
        acc[word] = (acc[word] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const mostCommon = Object.entries(wordCounts).sort(([, a], [, b]) => b - a)[0][0];

      if (mostCommon === "__direction__") {
        groupName += "-directions";
      } else {
        groupName += `-${mostCommon}`;
      }
    } else {
      // Fallback to index
      groupName += `-${index + 1}`;
    }
  }

  return groupName;
}

export function groupIconSets(
  pngFiles: string[],
  maxGroupSize: number = 15,
  minSubgroupSize: number = 3,
  maxExtrasGroupSize: number = 10
): NamedIconGroup[] {
  // Step 1: Group by first word
  const firstWordGroups = new Map<string, string[]>();
  for (const pngFile of pngFiles) {
    const filename = basename(pngFile, ".png");
    const firstWord = filename.split(/[-_]/)[0].toLowerCase();
    if (!firstWordGroups.has(firstWord)) {
      firstWordGroups.set(firstWord, []);
    }
    firstWordGroups.get(firstWord)!.push(pngFile);
  }

  const finalGroups: NamedIconGroup[] = [];

  for (const [firstWord, group] of firstWordGroups.entries()) {
    if (group.length > maxGroupSize) {
      // Step 2: Subgroup by second word, with special case for "up", "down", "left", "right", "bidirectional"
      const directionWords = new Set(["up", "down", "left", "right", "bidirectional"]);
      const secondWordGroups = new Map<string, string[]>();
      for (const pngFile of group) {
        const filename = basename(pngFile, ".png");
        const parts = filename.split(/[-_]/);
        let secondWord = parts[1] ? parts[1].toLowerCase() : "__none__";
        // Special case: treat "up", "down", "left", "right" as the same group
        if (directionWords.has(secondWord)) {
          secondWord = "__direction__";
        }
        if (!secondWordGroups.has(secondWord)) {
          secondWordGroups.set(secondWord, []);
        }
        secondWordGroups.get(secondWord)!.push(pngFile);
      }

      // Step 3: Collect small subgroups into extrasGroup
      const extrasGroup: string[] = [];
      let subgroupIndex = 0;

      for (const subgroup of secondWordGroups.values()) {
        if (subgroup.length < minSubgroupSize) {
          extrasGroup.push(...subgroup);
        } else {
          const groupName = generateGroupName(subgroup, firstWord, subgroupIndex);
          finalGroups.push({ name: groupName, files: subgroup });
          subgroupIndex++;
        }
      }

      // Split extras into multiple groups if needed
      if (extrasGroup.length > 0) {
        if (extrasGroup.length <= maxExtrasGroupSize) {
          // Single extras group
          finalGroups.push({ name: `${firstWord}-extras-1`, files: extrasGroup });
        } else {
          // Split into multiple extras groups
          let extrasIndex = 1;
          for (let i = 0; i < extrasGroup.length; i += maxExtrasGroupSize) {
            const chunk = extrasGroup.slice(i, i + maxExtrasGroupSize);
            finalGroups.push({ name: `${firstWord}-extras-${extrasIndex}`, files: chunk });
            extrasIndex++;
          }
        }
      }
    } else {
      const groupName = generateGroupName(group, firstWord);
      finalGroups.push({ name: groupName, files: group });
    }
  }

  // Save finalGroups to a JSON file, including both names and filenames
  const finalGroupsForSaving = finalGroups.map((group) => ({
    name: group.name,
    files: group.files.map((pngFile) => basename(pngFile, ".png")),
  }));

  writeFile(
    resolve("scripts", "build-logs", "icon-groups.json"),
    JSON.stringify(finalGroupsForSaving, null, 2),
    "utf-8"
  );

  return finalGroups;
}

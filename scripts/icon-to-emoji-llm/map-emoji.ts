import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { logInfo, logError, saveLogToFile } from "../utils/simple-build-log.js";
import { updateProgress, progressSpinner } from "../utils/progress-bar.js";

interface Assignment {
  filename: string;
  name: string;
  metaphor: string[];
  emoji: string;
  subEmoji: string;
  alternativeEmojis: string[];
  similarity: number;
}

interface EmojiAssignments {
  generated: string;
  total: number;
  assignments: Assignment[];
}

interface EmojiMapping {
  [key: string]: string;
}

interface EmojiTies {
  [key: string]: string[];
}

interface ConflictCandidate {
  filename: string;
  similarity: number;
  isPrimary: boolean; // true for emoji/emoji+subEmoji, false for alternativeEmojis
  altIndex?: number;  // index in alternativeEmojis array (for ordering)
}

async function createEmojiToIconMapping() {
  const stopSpinner = progressSpinner("Starting emoji-to-icon mapping process");
  
  try {
    // Read input file
    logInfo("Reading emoji-assignments.json file...");
    const inputPath = resolve("scripts/icon-to-emoji-llm/emoji-assignments.json");
    const inputData = await readFile(inputPath, "utf-8");
    const assignments: EmojiAssignments = JSON.parse(inputData);
    
    stopSpinner();
    logInfo(`Loaded ${assignments.total} assignments from ${assignments.generated}`);
    
    // Initialize mappings
    const emojiToIcon: EmojiMapping = {};
    const emojiTies: EmojiTies = {};
    const conflicts: { [key: string]: ConflictCandidate[] } = {};
    
    let processed = 0;
    let totalMappings = 0;
    let primaryMappings = 0;
    let alternativeMappings = 0;
    
    // Process each assignment
    logInfo("Processing emoji assignments...");
    for (const assignment of assignments.assignments) {
      const mappings: { emoji: string; isPrimary: boolean; altIndex?: number }[] = [];
      
      // Add primary emoji mapping
      if (assignment.emoji) {
        mappings.push({ emoji: assignment.emoji, isPrimary: true });
        primaryMappings++;
      }
      
      // Add emoji + subEmoji combination if subEmoji exists
      if (assignment.emoji && assignment.subEmoji && assignment.subEmoji.trim() !== "") {
        mappings.push({ emoji: assignment.emoji + assignment.subEmoji, isPrimary: true });
        primaryMappings++;
      }
      
      // Add alternative emojis
      // COMMENTED OUT: Alternative emoji processing
      /*
      if (assignment.alternativeEmojis && assignment.alternativeEmojis.length > 0) {
        assignment.alternativeEmojis.forEach((altEmoji, index) => {
          if (altEmoji && altEmoji.trim() !== "") {
            mappings.push({ emoji: altEmoji, isPrimary: false, altIndex: index });
            alternativeMappings++;
          }
        });
      }
      */
      
      // Process each mapping
      for (const mapping of mappings) {
        totalMappings++;
        
        // Check for conflicts
        if (!conflicts[mapping.emoji]) {
          conflicts[mapping.emoji] = [];
        }
        
        conflicts[mapping.emoji].push({
          filename: assignment.filename,
          similarity: assignment.similarity,
          isPrimary: mapping.isPrimary,
          altIndex: mapping.altIndex
        });
      }
      
      processed++;
      updateProgress(processed, assignments.total, "Processing assignments");
    }
    
    logInfo(`Created ${totalMappings} emoji mappings from ${assignments.total} assignments`);
    logInfo(`  - Primary mappings (emoji + emoji+subEmoji): ${primaryMappings}`);
    logInfo(`  - Alternative emoji mappings: ${alternativeMappings}`);
    
    // Resolve conflicts and create final mappings
    logInfo("Resolving conflicts and creating final mappings...");
    let conflictCount = 0;
    let tieCount = 0;
    let primaryWins = 0;
    let alternativeWins = 0;
    let alternativeDiscarded = 0;
    
    for (const [emojiKey, candidates] of Object.entries(conflicts)) {
      if (candidates.length > 1) {
        conflictCount++;
        
        // Separate primary and alternative candidates
        const primaryCandidates = candidates.filter(c => c.isPrimary);
        const alternativeCandidates = candidates.filter(c => !c.isPrimary);
        
        let winner: ConflictCandidate;
        let shouldAddToTies = false;
        
        if (primaryCandidates.length > 0) {
          // Primary candidates exist - they always win over alternatives
          if (primaryCandidates.length > 1) {
            // Multiple primary candidates - use similarity score
            primaryCandidates.sort((a, b) => b.similarity - a.similarity);
            winner = primaryCandidates[0];
            shouldAddToTies = true; // Add all candidates to ties when primary vs primary
            primaryWins++;
            
            logInfo(`Primary conflict resolved for ${emojiKey}: ${winner.filename} (similarity: ${winner.similarity}) beats ${primaryCandidates.length - 1} other primary + ${alternativeCandidates.length} alternative(s)`);
          } else {
            // Single primary candidate wins against alternatives
            winner = primaryCandidates[0];
            shouldAddToTies = primaryCandidates.length > 1; // Only add to ties if multiple primaries
            primaryWins++;
            
            if (alternativeCandidates.length > 0) {
              alternativeDiscarded += alternativeCandidates.length;
              logInfo(`Primary beats alternative for ${emojiKey}: ${winner.filename} (primary, similarity: ${winner.similarity}) beats ${alternativeCandidates.length} alternative(s)`);
            }
          }
        } else {
          // Only alternative candidates - first in array wins
          alternativeCandidates.sort((a, b) => (a.altIndex || 0) - (b.altIndex || 0));
          winner = alternativeCandidates[0];
          shouldAddToTies = false; // Alternative vs alternative conflicts don't go to ties
          alternativeWins++;
          alternativeDiscarded += alternativeCandidates.length - 1;
          
          logInfo(`Alternative conflict resolved for ${emojiKey}: ${winner.filename} (alt #${winner.altIndex}, similarity: ${winner.similarity}) beats ${alternativeCandidates.length - 1} other alternative(s)`);
        }
        
        // Set the winner
        emojiToIcon[emojiKey] = winner.filename;
        
        // Add to ties only if it's primary vs primary conflicts
        if (shouldAddToTies && primaryCandidates.length > 1) {
          emojiTies[emojiKey] = primaryCandidates.map(c => c.filename);
          tieCount++;
        }
        
      } else {
        // No conflict, simple assignment
        const candidate = candidates[0];
        emojiToIcon[emojiKey] = candidate.filename;
        
        if (candidate.isPrimary) {
          primaryWins++;
        } else {
          alternativeWins++;
        }
      }
    }
    
    logInfo(`Resolved ${conflictCount} conflicts, created ${tieCount} tie records`);
    logInfo(`  - Primary emoji wins: ${primaryWins}`);
    logInfo(`  - Alternative emoji wins: ${alternativeWins}`);
    logInfo(`  - Alternative emojis discarded: ${alternativeDiscarded}`);
    
    // Process manual tie-breaking overrides if file exists
    logInfo("Checking for manual tie-breaking overrides...");
    const manualTieBreakPath = resolve("scripts/icon-to-emoji-llm/emoji-ties-manually-broken.json");
    let manualOverrides = 0;
    
    try {
      const manualTieData = await readFile(manualTieBreakPath, "utf-8");
      const manualTies = JSON.parse(manualTieData);
      
      if (manualTies.ties && typeof manualTies.ties === 'object') {
        logInfo("Found manual tie-breaking file, applying overrides...");
        
        for (const [emoji, tieArray] of Object.entries(manualTies.ties)) {
          if (Array.isArray(tieArray) && tieArray.length > 0) {
            const manualWinner = tieArray[0] as string;
            if (emojiToIcon[emoji] && emojiToIcon[emoji] !== manualWinner) {
              const previousWinner = emojiToIcon[emoji];
              emojiToIcon[emoji] = manualWinner;
              manualOverrides++;
              logInfo(`Manual override for ${emoji}: ${previousWinner} → ${manualWinner}`);
            }
          }
        }
        
        logInfo(`Applied ${manualOverrides} manual tie-breaking overrides`);
      } else {
        logInfo("Manual tie-breaking file found but has invalid format");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logInfo("No manual tie-breaking file found (emoji-ties-manually-broken.json)");
      } else {
        logError("Error reading manual tie-breaking file", error);
      }
    }
    
    // Write output files
    logInfo("Writing output files...");
    const outputDir = "scripts/icon-to-emoji-llm";
    
    const emojiToIconPath = resolve(outputDir, "emoji-to-icon.json");
    const emojiToIconByEmojiPath = resolve(outputDir, "emoji-to-icon-by-emoji.json");
    const emojiTiesPath = resolve(outputDir, "emoji-ties.json");
    
    // Sort emoji mappings alphabetically by icon name (value)
    const sortedEmojiToIcon: EmojiMapping = {};
    const sortedEmojiEntries = Object.entries(emojiToIcon).sort(([, iconNameA], [, iconNameB]) => {
      // Sort alphabetically by icon name (value)
      return iconNameA.localeCompare(iconNameB);
    });
    
    for (const [emoji, iconName] of sortedEmojiEntries) {
      sortedEmojiToIcon[emoji] = iconName;
    }
    
    // Sort emoji mappings alphabetically by emoji key
    const sortedEmojiToIconByEmoji: EmojiMapping = {};
    const sortedEmojiKeys = Object.keys(emojiToIcon).sort((a, b) => {
      // Sort alphabetically by emoji key (using Unicode comparison)
      const emojiRegex = /\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;
      const aLength = a.match(emojiRegex)?.length || 0;  
      const bLength = b.match(emojiRegex)?.length || 0;
      if (aLength !== bLength) {
        return aLength - bLength;
      }
      return a.localeCompare(b);
    });
    
    for (const emoji of sortedEmojiKeys) {
      sortedEmojiToIconByEmoji[emoji] = emojiToIcon[emoji];
    }
    
    // Sort emoji ties by length first, then alphabetically
    const sortedEmojiTies: EmojiTies = {};
    const sortedTieKeys = Object.keys(emojiTies).sort((a, b) => {
      // First sort by length (shorter first)
      if (a.length !== b.length) {
        return a.length - b.length;
      }
      // Then sort alphabetically (using Unicode comparison)
      return a.localeCompare(b);
    });
    
    for (const key of sortedTieKeys) {
      sortedEmojiTies[key] = emojiTies[key];
    }
    
    const emojiToIconData = {
      generated: new Date().toISOString(),
      totalMappings: Object.keys(emojiToIcon).length,
      primaryMappings: primaryMappings,
      alternativeMappings: alternativeMappings,
      manualOverrides: manualOverrides,
      note: "Sorted alphabetically by icon name (value). Manual overrides from emoji-ties-manually-broken.json are applied if the file exists.",
      mappings: sortedEmojiToIcon
    };
    
    const emojiToIconByEmojiData = {
      generated: new Date().toISOString(),
      totalMappings: Object.keys(emojiToIcon).length,
      primaryMappings: primaryMappings,
      alternativeMappings: alternativeMappings,
      manualOverrides: manualOverrides,
      note: "Sorted alphabetically by emoji key. Manual overrides from emoji-ties-manually-broken.json are applied if the file exists.",
      mappings: sortedEmojiToIconByEmoji
    };
    
    const emojiTiesData = {
      generated: new Date().toISOString(),
      totalTies: Object.keys(emojiTies).length,
      note: "Only contains primary emoji conflicts (primary vs primary). Alternative emoji conflicts are not included. Sorted by emoji length (shorter first), then alphabetically within each length group. To manually override tie-breaking, copy this file to 'emoji-ties-manually-broken.json' and reorder the arrays - the first item in each array will be used as the winner.",
      ties: sortedEmojiTies
    };
    
    await writeFile(emojiToIconPath, JSON.stringify(emojiToIconData, null, 2), "utf-8");
    await writeFile(emojiToIconByEmojiPath, JSON.stringify(emojiToIconByEmojiData, null, 2), "utf-8");
    await writeFile(emojiTiesPath, JSON.stringify(emojiTiesData, null, 2), "utf-8");
    
    logInfo(`✅ emoji-to-icon.json created with ${Object.keys(emojiToIcon).length} mappings`);
    logInfo(`✅ emoji-to-icon-by-emoji.json created with ${Object.keys(sortedEmojiToIconByEmoji).length} mappings`);
    logInfo(`✅ emoji-ties.json created with ${Object.keys(emojiTies).length} tie records (primary conflicts only)`);
    
    // Summary
    logInfo("=== SUMMARY ===");
    logInfo(`Total assignments processed: ${assignments.total}`);
    logInfo(`Total emoji mappings created: ${totalMappings}`);
    logInfo(`  - Primary mappings: ${primaryMappings}`);
    logInfo(`  - Alternative mappings: ${alternativeMappings}`);
    logInfo(`Conflicts resolved: ${conflictCount}`);
    logInfo(`  - Primary emoji wins: ${primaryWins}`);
    logInfo(`  - Alternative emoji wins: ${alternativeWins}`);
    logInfo(`  - Alternative emojis discarded: ${alternativeDiscarded}`);
    logInfo(`Manual overrides applied: ${manualOverrides}`);
    logInfo(`Final emoji-to-icon mappings: ${Object.keys(emojiToIcon).length}`);
    logInfo(`Output files created: 3`);
    logInfo(`  - emoji-to-icon.json: sorted by icon name`);
    logInfo(`  - emoji-to-icon-by-emoji.json: sorted by emoji key`);
    logInfo(`  - emoji-ties.json: sorted by emoji length then alphabetically`);
    logInfo(`Emoji ties recorded: ${Object.keys(emojiTies).length} (primary conflicts only)`);
    logInfo("=== END SUMMARY ===");
    
  } catch (error) {
    stopSpinner();
    logError("Failed to create emoji-to-icon mapping", error);
    throw error;
  }
}

// Run the script
async function main() {
  try {
    await createEmojiToIconMapping();
    await saveLogToFile("emoji-mapping");
    process.exit(0);
  } catch (error) {
    logError("Script failed", error);
    await saveLogToFile("emoji-mapping");
    process.exit(1);
  }
}

main();
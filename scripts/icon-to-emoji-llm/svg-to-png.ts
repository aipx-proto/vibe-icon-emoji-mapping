import { readdir, readFile } from "fs/promises";
import { resolve, extname, basename } from "path";
import { mkdirSync, existsSync } from "fs";
import sharp from "sharp";
import { from, mergeMap, lastValueFrom } from "rxjs";
import { updateProgress } from "../utils/progress-bar";
import { logInfo, logError, saveLogToFile } from "../utils/simple-build-log";

const publicDir = resolve("public");
const outputDir = resolve("pngs");

main();

async function main() {
  logInfo("Starting SVG to PNG conversion process...");

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  logInfo("Scanning for SVG files...");
  const svgFiles = await getSvgFiles();

  if (svgFiles.length === 0) {
    logInfo("No SVG files found for conversion.");
    await saveLogToFile("svg-to-png");
    return;
  }

  logInfo(`Found ${svgFiles.length} SVG files to convert`);

  let progress = 0;
  let errors = 0;

  const conversion$ = from(svgFiles).pipe(
    mergeMap(async (svgFile) => {
      try {
        await convertSvgToPng(svgFile);
      } catch (error) {
        logError(`Failed to convert ${svgFile}`, error);
        errors++;
      }
      updateProgress(++progress, svgFiles.length, "Converting SVGs to PNG", errors);
    }, 8) // Process 8 files concurrently
  );

  await lastValueFrom(conversion$);

  logInfo(`Conversion completed! ${svgFiles.length - errors} files converted successfully.`);
  if (errors > 0) {
    logInfo(`${errors} files failed to convert.`);
  }

  logInfo("Saving log to file...");
  await saveLogToFile("svg-to-png");
  logInfo("log file saved to ./scripts/build-logs/svg-to-png.log");
}

async function getSvgFiles(): Promise<string[]> {
  try {
    const files = await readdir(publicDir);

    // Filter for SVG files that don't end with -00-style.svg pattern
    const svgFiles = files.filter((file) => {
      if (extname(file) !== ".svg") return false;

      // Exclude files ending with pattern like *-00-filled.svg or *-00-regular.svg
      const excludePattern = /-(filled|regular)\.svg$/;
      if (excludePattern.test(file)) return false;

      return true;
    });

    return svgFiles.map((file) => resolve(publicDir, file));
  } catch (error) {
    logError("Failed to read public directory", error);
    return [];
  }
}

async function convertSvgToPng(svgFilePath: string): Promise<void> {
  const svgContent = await readFile(svgFilePath, "utf-8");

  // Optional: Modify SVG content here if needed
  const modifiedSvgContent = modifySvgContent(svgContent);

  if (!modifiedSvgContent) {
    logError(`No valid SVG content found for ${svgFilePath}`);
    return;
  }

  // Create PNG filename
  const fileName = basename(svgFilePath, ".svg");
  const pngFilePath = resolve(outputDir, `${fileName}.png`);

  // Convert SVG to PNG using Sharp
  await sharp(Buffer.from(modifiedSvgContent))
    .resize(ICON_SIZE, ICON_SIZE) // Set desired PNG size
    .flatten({ background: "#ffffff" }) // Add white background
    .png({
      quality: 90,
      compressionLevel: 9,
    })
    .toFile(pngFilePath);
}

function modifySvgContent(svgContent: string): string | null {
  // Match all <symbol ...>...</symbol> blocks and extract id, viewBox, and content
  const symbolRegex = /<symbol\s+id="([^"]+)"[^>]*viewBox="([^"]*)"[^>]*>([\s\S]*?)<\/symbol>/g;
  const symbols: { id: string; viewBox: string; content: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = symbolRegex.exec(svgContent)) !== null) {
    symbols.push({
      id: match[1],
      viewBox: match[2],
      content: match[3],
    });
  }

  if (symbols.length === 0) {
    console.error("No <symbol> found in SVG content");
    return null;
  }

  // Try to find "regular", then "filled", then any
  let chosen = symbols.find((s) => s.id === "regular");
  if (!chosen) {
    chosen = symbols.find((s) => s.id === "filled");
  }
  if (!chosen) {
    chosen = symbols[0];
    console.error(`No 'regular' or 'filled' symbol found in SVG content, using first symbol with id="${chosen.id}"`);
  }

  // Create a standalone SVG with the chosen symbol content
  const standaloneSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${
    chosen.viewBox
  }" width="${ICON_SIZE}" height="${ICON_SIZE}">
${chosen.content.trim()}
</svg>`;

  return standaloneSvg;
}

/*
 * the most common icon sizes are 20px and 16px, 20 is by far the most common with 2646 icons (other rare sizes are 12, 24, 32, 48)
 * we want to choose an icon size that is a multiple of the source so the png anti-aliasing is well (crispy)
 * 80 is the smallest size that factors into 16 and 20
 */
const ICON_SIZE = 80;

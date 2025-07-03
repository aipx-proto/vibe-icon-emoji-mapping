import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { OpenAI } from "openai";
import examples from "./examples.json";
import type { EmojiAssignment, EmojiAssignmentResponse, PngMetadata } from "./types";

export const createFewShotExamples = async function (pngDir: string) {
  const assignmentExamples = await Promise.all(
    Object.entries(examples as Record<string, EmojiAssignment[]>).map(async ([_, value]) => {
      const assistantResponse: EmojiAssignmentResponse[] = value.map((assignment) => {
        return {
          emoji: assignment.emoji,
          subEmoji: assignment.subEmoji,
          alternativeEmojis: assignment.alternativeEmojis,
          similarity: assignment.similarity,
        };
      });

      const assistantMessage = {
        role: "assistant",
        content: JSON.stringify(assistantResponse, null, 2),
      };

      const userMessages = await Promise.all(
        value.map(async (assignment) => {
          return createUserMessage(assignment, pngDir);
        })
      );
      return [...userMessages, assistantMessage];
    })
  );
  const fewShotExamples =
    assignmentExamples.flat() as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming["messages"];

  writeFile(
    resolve("scripts", "build-logs", "few-shot-example-chat-messages.json"),
    JSON.stringify(fewShotExamples, null, 2)
  );

  return fewShotExamples;
};

export const createUserMessage = async function (pngMetadata: PngMetadata, pngDir: string) {
  const imageBuffer = await readFile(resolve(pngDir, pngMetadata.filename + ".png"));
  const base64Image = imageBuffer.toString("base64");
  const metaphorContext =
    pngMetadata.metaphor.length > 0 ? `\n\nRelated concepts: ${pngMetadata.metaphor.join(", ")}` : "";

  return {
    role: "user",
    content: [
      {
        type: "text",
        content: `Icon name: ${pngMetadata.name}${metaphorContext}`,
      },
      {
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${base64Image}`,
        },
      },
    ],
  } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
};

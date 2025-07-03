import type { MetadataEntry } from "../../typings/icon-index";

export interface EmojiAssignmentResponse {
  emoji: string;
  subEmoji?: string;
  alternativeEmojis: string[];
  similarity: number;
}

export interface PngMetadata extends Omit<MetadataEntry, "options"> {
  filename: string;
}

export interface EmojiAssignment extends PngMetadata, EmojiAssignmentResponse {}

export interface NamedIconGroup {
  name: string;
  files: string[];
}

export interface GroupAssignmentResult {
  groupName: string;
  generated: string;
  assignments: EmojiAssignment[];
}
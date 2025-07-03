export interface IconIndex {
  icons: Record<string, [metaphors: string[], options: IconOption[], sizes: number[]]>;
}

export type MetadataMap = Record<string, { metaphor: string[]; options: IconOption[] }>;

export interface MetadataEntry {
  name: string;
  metaphor: string[];
  options: IconOption[];
}

export interface IconOption {
  size: number;
  style: string;
}

export interface InMemoryIcon {
  name: string;
  lowerName: string;
  filename: string;
  metaphors: string[];
  options: IconOption[];
  sizes: number[];
}

export interface SearchResult extends InMemoryIcon {
  score: number;
  nameHtml: string;
  metaphorHtmls: string[];
}

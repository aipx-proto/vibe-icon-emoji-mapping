// Convert display name to code name format
// there is a upstream bug that converts "Multipler _5x" to "multipler_5x"
// this makes it indistinguishable from "Multipler 5x". We will inherit the bug for now by collapsing multiple underscores
export function displayNameToSourceAssetSVGFilename(displayName: string): string {
  return displayName.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_").replace(/_+/g, "_");
}

export function displayNameToVibeIconSVGFilename(displayName: string): string {
  return displayName.toLocaleLowerCase().replace(/\s+/g, "-");
}

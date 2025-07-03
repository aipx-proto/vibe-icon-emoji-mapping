/**
 * Determine target size once: prefer 20, then 16, otherwise smallest
 */
export function getMostSensibleIconSize(sizes: number[]): number | undefined {
  const uniqueSizes = [...new Set(sizes)].sort((a, b) => a - b);
  return uniqueSizes.includes(20) ? 20 : uniqueSizes.includes(16) ? 16 : uniqueSizes[0];
}

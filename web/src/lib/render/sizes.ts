export function domainRadius(hits: number): number {
  return Math.min(5 + Math.log2(Math.max(1, hits)) * 1.5, 16);
}

export function clientRadius(hits: number): number {
  return Math.min(10 + Math.log2(Math.max(1, hits)) * 1.5, 26);
}

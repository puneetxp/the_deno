export function mergeObject(
  x: Record<string, any[]>,
  y: Record<string, any[]>,
): Record<string, any[]> {
  for (const [key, value] of Object.entries(y)) {
    if (!x[key]) {
      x[key] = [];
    }
    x[key] = [...x[key], ...value];
  }
  return x;
}
export function intersect(a: string[], b: string[]): boolean {
  for (const element of a) {
    if (b.includes(element)) {
      return true;
    }
  }
  return false;
}

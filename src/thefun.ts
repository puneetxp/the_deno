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

export function as_on(date: string | null | undefined): string | null {
  if (!date) return null;
  return `${date.substring(0, 10)} 23:59:59`;
}

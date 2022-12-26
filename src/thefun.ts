export function mergeObject(
 x: Record<string, any[]>,
 y: Record<string, any[]>
) {
 for (const [key, value] of Object.entries(y)) {
   if (!x[key]) {
     x[key] = [];
   }
   x[key] = [...x[key], ...value];
 }
 return x;
}

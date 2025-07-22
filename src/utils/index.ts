/**
 * Type-safe tuple validation for arrays of numbers.
 */
export function isValidNumberTuple(arr: (number | undefined)[], length: number): arr is [number, number, number] {
  return arr.length === length && arr.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Simple hash function for strings (length + first/last chars).
 */
export function hashString(str: string): string {
  return `${str.length}-${str.substring(0, 10)}-${str.substring(str.length - 10)}`;
} 
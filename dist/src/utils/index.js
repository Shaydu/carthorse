"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidNumberTuple = isValidNumberTuple;
exports.hashString = hashString;
/**
 * Type-safe tuple validation for arrays of numbers.
 */
function isValidNumberTuple(arr, length) {
    return arr.length === length && arr.every((v) => typeof v === 'number' && Number.isFinite(v));
}
/**
 * Simple hash function for strings (length + first/last chars).
 */
function hashString(str) {
    return `${str.length}-${str.substring(0, 10)}-${str.substring(str.length - 10)}`;
}
//# sourceMappingURL=index.js.map
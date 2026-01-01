/**
 * Returns the values as an array of javascript numbers
 *
 * @param val - The javascript object for the specified element in the metadata
 * @returns {*}
 */
export default function toNumber(val) {
  if (Array.isArray(val)) {
    return val.map(v => (v !== undefined ? Number(v) : v));
  } else if (val && typeof val === 'object' && typeof val[Symbol.iterator] === 'function') {
    // Handle iterable objects (like typed arrays)
    return Array.from(val).map(v => (v !== undefined ? Number(v) : v));
  } else if (val && typeof val === 'object' && 'length' in val) {
    // Handle array-like objects (with length property but not iterable)
    return Array.from({ length: val.length }, (_, i) => {
      const v = val[i];
      return v !== undefined ? Number(v) : v;
    });
  } else {
    return val !== undefined ? Number(val) : val;
  }
}

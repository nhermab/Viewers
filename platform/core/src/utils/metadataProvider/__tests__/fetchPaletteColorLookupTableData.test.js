import fetchPaletteColorLookupTableData from '../fetchPaletteColorLookupTableData';

describe('fetchPaletteColorLookupTableData', () => {
  test('returns undefined when descriptor missing and no data', () => {
    const item = {};
    const result = fetchPaletteColorLookupTableData(item, 'RedPaletteColorLookupTableData', 'RedPaletteColorLookupTableDescriptor');
    expect(result).toBeUndefined();
  });

  test('decodes InlineBinary into palette array', () => {
    // Prepare a small palette (3 entries, 8-bit)
    const palette = new Uint8Array([10, 20, 30]);
    const inline = btoa(String.fromCharCode(...palette));
    const item = {
      RedPaletteColorLookupTableDescriptor: [3, 0, 8],
      RedPaletteColorLookupTableData: {
        InlineBinary: inline,
      },
    };

    const result = fetchPaletteColorLookupTableData(item, 'RedPaletteColorLookupTableData', 'RedPaletteColorLookupTableDescriptor');
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toBe(10);
    expect(result[1]).toBe(20);
    expect(result[2]).toBe(30);
  });

  test('returns promise when retrieveBulkData provided', async () => {
    const paletteValues = new Uint8Array([1,2,3,4]);
    const item = {
      RedPaletteColorLookupTableDescriptor: [4, 0, 8],
      RedPaletteColorLookupTableData: {
        retrieveBulkData: () => Promise.resolve(paletteValues.buffer),
      },
    };

    const result = fetchPaletteColorLookupTableData(item, 'RedPaletteColorLookupTableData', 'RedPaletteColorLookupTableDescriptor');
    expect(result).toBeInstanceOf(Promise);
    const resolved = await result;
    expect(resolved[0]).toBe(1);
    expect(resolved[3]).toBe(4);
  });
});


import metadataProvider from '../MetadataProvider';

describe('MetadataProvider effective pixel preference', () => {
  test('prefers _effective fields over instance DICOM tags', () => {
    const instance = {
      _effectiveSamplesPerPixel: 3,
      _effectivePhotometricInterpretation: 'RGB',
      SamplesPerPixel: 1,
      PhotometricInterpretation: 'PALETTE COLOR',
      Rows: 10,
      Columns: 10,
    };

    // Simulate DicomMetadataStore.getInstance by temporarily adding to provider's internal methods
    // The MetadataProvider.getTagFromInstance expects an instance; we'll call the IMAGE_PIXEL_MODULE handler indirectly.
    const result = metadataProvider.getTagFromInstance('imagePixelModule', instance);

    expect(result.samplesPerPixel).toBe(3);
    expect(result.photometricInterpretation).toBe('RGB');
  });
});


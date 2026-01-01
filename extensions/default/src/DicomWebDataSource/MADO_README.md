# MADO Manifest-Driven Loading Extension

## Overview

This extension enables **OHIFv3** to load DICOM studies using **MADO (Manifest for DICOM Objects)** files when **QIDO-RS** is unavailable. The MADO file acts as a "pre-defined query result" containing Study/Series/Instance UIDs, which are then used to fetch full metadata via **WADO-RS**.

## Architecture

### Workflow

1. **User Navigation**: User visits `/mado?manifestUrl=<url>`
2. **Manifest Fetch**: Binary MADO file is fetched via HTTP GET
3. **Client-Side Parsing**: `dcmjs` extracts UIDs from the MADO KOS document
4. **Metadata Enrichment**: WADO-RS Metadata requests fetch rendering tags (Pixel Spacing, Orientations, etc.)
5. **State Injection**: Metadata is populated into `DicomMetadataStore`
6. **Viewer Launch**: User is redirected to the viewer with the loaded study

### Key Components

#### 1. **MadoParser.ts**
- Parses DICOM Key Object Selection (KOS) documents
- Extracts Study/Series/Instance UIDs from Evidence Sequence (0040,A375)
- Handles RetrieveURL (0008,1190) for dynamic WADO-RS endpoints

#### 2. **retrieveMadoMetadata.ts**
- Orchestrates WADO-RS metadata requests for all series in the manifest
- Naturalizes DICOM JSON to OHIF-compatible format
- Registers imageIds with the metadata provider

#### 3. **DicomWebDataSource Integration**
- Adds `retrieve.series.madoMetadata()` method
- Seamlessly integrates with existing OHIF data source architecture

#### 4. **MadoViewer Route**
- React component that handles the `/mado` route
- Manages loading state and error handling
- Redirects to viewer after successful load

## Installation

### 1. Files Added

The following files have been created:

```
extensions/default/src/DicomWebDataSource/
├── MadoParser.ts                    # MADO manifest parser
└── retrieveMadoMetadata.ts          # Metadata retrieval orchestrator

platform/app/src/routes/
└── MadoViewer.tsx                   # MADO route component
```

### 2. Modified Files

```
extensions/default/src/DicomWebDataSource/index.ts   # Added MADO support
platform/app/src/routes/index.tsx                     # Registered MADO route
```

## Usage

### Basic Usage

Navigate to the MADO viewer with a manifest URL:

```
http://localhost:3000/mado?manifestUrl=http://your-server.com/path/to/manifest.dcm
```

### Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `manifestUrl` | Yes | URL to the MADO manifest file |
| `madoUrl` | Yes (alt) | Alternative parameter name for manifest URL |
| `dataSource` | No | Specify which data source to use (default: first available) |
| `mode` | No | Viewer mode to use (default: from app config) |

### Example URLs

**Basic:**
```
/mado?manifestUrl=http://172.20.240.184:8042/studies/1.2.3/manifest.dcm
```

**With specific mode:**
```
/mado?manifestUrl=http://server/manifest.dcm&mode=viewer
```

**With data source:**
```
/mado?manifestUrl=http://server/manifest.dcm&dataSource=dicomweb
```

## MADO File Format

### Expected Structure

The MADO file must be a **DICOM Key Object Selection (KOS)** document with:

```
Current Requested Procedure Evidence Sequence (0040,A375)
  └─ Referenced Series Sequence (0008,1115)
      ├─ Series Instance UID (0020,000E)
      ├─ Series Description (0008,103E) [Optional]
      ├─ Retrieve URL (0008,1190) [Optional]
      └─ Referenced SOP Sequence (0008,1199)
          ├─ Referenced SOP Class UID (0008,1150)
          ├─ Referenced SOP Instance UID (0008,1155)
          └─ Instance Number (0020,0013) [Optional]
```

### Required Tags

**Study Level:**
- `StudyInstanceUID` (0020,000D)
- `PatientName` (0010,0010) [Optional]
- `PatientID` (0010,0020) [Optional]

**Series Level (in Evidence Sequence):**
- `SeriesInstanceUID` (0020,000E)

**Instance Level (in Referenced SOP Sequence):**
- `SOPClassUID` (0008,1150)
- `SOPInstanceUID` (0008,1155)

## Configuration

### Data Source Configuration

In your `app-config.js`, ensure the DicomWeb data source is properly configured:

```javascript
{
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        name: 'DCM4CHEE',
        wadoRoot: 'http://your-server:8080/dcm4chee-arc/aets/DCM4CHEE/rs',
        qidoRoot: 'http://your-server:8080/dcm4chee-arc/aets/DCM4CHEE/rs', // Not used for MADO
        wadoUri: 'http://your-server:8080/dcm4chee-arc/aets/DCM4CHEE/wado',
        // Other config...
      }
    }
  ]
}
```

### Dynamic WADO-RS Endpoints

If your MADO file contains `RetrieveURL (0008,1190)` tags, the extension will automatically use those endpoints instead of the default `wadoRoot`. This allows each series to come from a different server.

**Example RetrieveURL in MADO:**
```
http://172.20.240.184:8042/dicom-web/studies/1.2.3/series/1.2.3.4
```

The extension extracts the base URL:
```
http://172.20.240.184:8042/dicom-web
```

## API Reference

### MadoParser

```typescript
class MadoParser {
  /**
   * Parse a MADO manifest file
   * @param arrayBuffer - Raw DICOM P10 file buffer
   * @returns Array of display sets with UIDs
   */
  static parse(arrayBuffer: ArrayBuffer): MadoDisplaySet[];

  /**
   * Fetch a MADO manifest from a URL
   * @param manifestUrl - URL to fetch from
   * @param headers - Optional auth headers
   * @returns Promise resolving to ArrayBuffer
   */
  static fetchManifest(
    manifestUrl: string,
    headers?: HeadersInit
  ): Promise<ArrayBuffer>;

  /**
   * Validate parsed MADO data
   * @param displaySets - Parsed display sets
   * @returns True if valid
   */
  static validate(displaySets: MadoDisplaySet[]): boolean;
}
```

### retrieveMadoMetadata

```typescript
/**
 * Retrieve full metadata for series in a MADO manifest
 * @param options - Configuration options
 */
async function retrieveMadoMetadata(
  options: MadoMetadataOptions
): Promise<void>;

interface MadoMetadataOptions {
  displaySets: MadoDisplaySet[];
  wadoRoot: string;
  dicomWebClient: any;
  getAuthorizationHeader: () => HeadersInterface;
  getImageIdsForInstance: (params: { instance: any }) => string;
  dicomWebConfig: any;
  madeInClient?: boolean;
}
```

### Data Source Method

```typescript
// Available on DicomWebDataSource
dataSource.retrieve.series.madoMetadata({
  manifestUrl: string,
  madeInClient?: boolean
}): Promise<SeriesSummaryMetadata[]>;
```

## Required Metadata for Rendering

The MADO file contains only UIDs. The following tags are fetched via WADO-RS Metadata:

### Critical Tags

| Category | Tags |
|----------|------|
| **Modality** | `Modality`, `SOPClassUID` |
| **Image Geometry** | `ImageOrientationPatient`, `ImagePositionPatient`, `PixelSpacing` |
| **Pixel Pipeline** | `SamplesPerPixel`, `PhotometricInterpretation`, `Rows`, `Columns` |
| **Presentation** | `WindowCenter`, `WindowWidth`, `RescaleSlope`, `RescaleIntercept` |
| **Frames** | `NumberOfFrames` |

## Error Handling

### Common Errors

**1. Missing manifestUrl Parameter**
```
Error: Missing required parameter: manifestUrl or madoUrl must be provided
```
**Solution:** Ensure the URL includes `?manifestUrl=...`

**2. CORS Issues**
```
Error: Failed to fetch MADO manifest: Network error
```
**Solution:** Configure CORS headers on both the manifest server and WADO-RS server:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Authorization, Content-Type
```

**3. Data Source Not Supporting MADO**
```
Error: The active data source does not support MADO manifest loading
```
**Solution:** Ensure you're using the updated DicomWebDataSource

**4. Invalid MADO Structure**
```
Error: MADO validation failed
```
**Solution:** Check that the MADO file contains Evidence Sequence (0040,A375)

### Logging

Enable console logging to debug issues:

```javascript
// In browser console
localStorage.setItem('debug', 'ohif:*');
```

## Security Considerations

### Authentication

If your WADO-RS server requires authentication:

1. **Token-based Auth:** The extension automatically uses headers from `userAuthenticationService.getAuthorizationHeader()`

2. **Session-based Auth:** Ensure cookies are included in requests (credentials: 'include')

### CORS Configuration

**Minimum CORS headers required:**

```
Access-Control-Allow-Origin: https://your-ohif-domain.com
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, Accept
Access-Control-Expose-Headers: Content-Type, Content-Length
```

## Performance Optimization

### Parallel Loading

The extension fetches metadata for all series in parallel, reducing total load time.

### Caching

OHIF's `DicomMetadataStore` caches loaded metadata, preventing duplicate requests.

### Lazy Loading

If `enableStudyLazyLoad` is configured, series metadata loads asynchronously as needed.

## Testing

### Manual Testing

1. **Create a test MADO file** using dcmtk:
```bash
dcmmkdir --recurse /path/to/dicoms /path/to/output/DICOMDIR
# Convert DICOMDIR to KOS format (requires custom tool)
```

2. **Host the MADO file** on a web server with CORS enabled

3. **Navigate to the MADO viewer:**
```
http://localhost:3000/mado?manifestUrl=http://localhost:8080/test-manifest.dcm
```

4. **Verify:**
   - Console shows "MADO manifest parsed successfully"
   - Metadata requests are made to WADO-RS
   - Viewer loads with the study

### Integration Testing

```javascript
// Example test case
describe('MADO Viewer', () => {
  it('should load study from manifest', async () => {
    const manifestUrl = 'http://test-server/manifest.dcm';
    
    // Navigate to MADO route
    await page.goto(`/mado?manifestUrl=${manifestUrl}`);
    
    // Wait for redirect to viewer
    await page.waitForURL(/\/viewer\?StudyInstanceUIDs=/);
    
    // Verify study loaded
    const viewport = await page.locator('[data-cy="viewport"]');
    await expect(viewport).toBeVisible();
  });
});
```

## Troubleshooting

### Study Not Loading

1. **Check browser console** for errors
2. **Verify MADO file** is valid DICOM (use `dcmdump`)
3. **Test WADO-RS endpoint** directly:
```bash
curl -H "Accept: application/dicom+json" \
  http://server/studies/{studyUID}/series/{seriesUID}/metadata
```

### Slow Loading

1. **Check network tab** for slow requests
2. **Verify parallel loading** is working (multiple concurrent requests)
3. **Consider server-side performance** of WADO-RS endpoint

### Image Not Rendering

1. **Check metadata store:**
```javascript
// In browser console
OHIF.DicomMetadataStore.getSeries(studyUID, seriesUID)
```

2. **Verify required tags** are present (ImageOrientationPatient, etc.)

## Future Enhancements

### Planned Features

- [ ] **Bulk Metadata Retrieval:** Single WADO-RS request for multiple series
- [ ] **Manifest Caching:** Cache parsed manifests in localStorage
- [ ] **Progress Indicators:** Show loading progress per series
- [ ] **Error Recovery:** Retry failed series loads
- [ ] **Manifest Validation UI:** Visual feedback for invalid manifests

## References

- [DICOM Part 18 - Web Services](http://dicom.nema.org/medical/dicom/current/output/html/part18.html)
- [WADO-RS Metadata Retrieval](http://dicom.nema.org/medical/dicom/current/output/html/part18.html#sect_10.4)
- [Key Object Selection (KOS)](http://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.17.6.html)

## License

This extension is part of OHIF and follows the same license.

## Support

For issues or questions:
- GitHub Issues: https://github.com/OHIF/Viewers/issues
- Discussions: https://github.com/OHIF/Viewers/discussions


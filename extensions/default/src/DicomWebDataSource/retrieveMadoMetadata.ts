import dcmjs from 'dcmjs';
import { DicomMetadataStore, classes } from '@ohif/core';
import { api } from 'dicomweb-client';
import type { MadoDisplaySet } from './MadoParser';
import { synthesizeInstanceMetadata, synthesizeSeriesMetadata } from './synthesizeMetadataFromMado';

const { DicomMessage, DicomDict } = dcmjs.data;
const metadataProvider = classes.MetadataProvider;

// --- Interfaces ---

export interface ExtractedSeriesMetadata {
  // Image Pixel Module
  Rows?: number;
  Columns?: number;
  BitsAllocated?: number;
  BitsStored?: number;
  HighBit?: number;
  PixelRepresentation?: number;
  SamplesPerPixel?: number;
  PhotometricInterpretation?: string;
  PlanarConfiguration?: number;
  PixelAspectRatio?: number;
  SmallestPixelValue?: number;
  LargestPixelValue?: number;

  // Image Plane Module
  PixelSpacing?: number[];
  ImagerPixelSpacing?: number[];
  ImageOrientationPatient?: number[];
  ImagePositionPatient?: number[];
  SliceThickness?: number;
  SpacingBetweenSlices?: number;
  SliceLocation?: number;

  // VOI LUT Module
  WindowCenter?: number | number[];
  WindowWidth?: number | number[];
  RescaleIntercept?: number;
  RescaleSlope?: number;
  RescaleType?: string;
  VOILUTFunction?: string;

  // Frame of Reference
  FrameOfReferenceUID?: string;

  // Multi-frame
  NumberOfFrames?: number;
  FrameTime?: number;
  FrameIncrementPointer?: string;
  PerFrameFunctionalGroupsSequence?: any[];
  SharedFunctionalGroupsSequence?: any[];

  // Image Identification
  ImageType?: string[];
  AcquisitionNumber?: number;
  AcquisitionDate?: string;
  AcquisitionTime?: string;
  InstanceNumber?: number;

  // Lossy compression info
  LossyImageCompression?: string;
  LossyImageCompressionRatio?: number;
  LossyImageCompressionMethod?: string;

  // Palette Color Lookup Table
  RedPaletteColorLookupTableDescriptor?: number[];
  GreenPaletteColorLookupTableDescriptor?: number[];
  BluePaletteColorLookupTableDescriptor?: number[];
  RedPaletteColorLookupTableData?: number[];
  GreenPaletteColorLookupTableData?: number[];
  BluePaletteColorLookupTableData?: number[];
  PaletteColorLookupTableUID?: string;

  // Segmented Palette Color Lookup Table
  SegmentedRedPaletteColorLookupTableData?: number[];
  SegmentedGreenPaletteColorLookupTableData?: number[];
  SegmentedBluePaletteColorLookupTableData?: number[];

  // Ultrasound calibration
  SequenceOfUltrasoundRegions?: any[];

  // PET specific
  CorrectedImage?: string[];
  Units?: string;
  DecayCorrection?: string;
  RadiopharmaceuticalInformationSequence?: any[];
  FrameReferenceTime?: number;
  ActualFrameDuration?: number;
}

interface MadoMetadataOptions {
  displaySets: MadoDisplaySet[];
  wadoRoot: string;
  getImageIdsForInstance: (params: { instance: any; frame?: number }) => string;
  dicomWebConfig: { wadoUri: string; [key: string]: any };
  madeInClient?: boolean;
  getAuthorizationHeader?: () => { Authorization?: string };
  dicomWebClient?: api.DICOMwebClient; // optional DICOMweb client (dicomweb-client api.DICOMwebClient instance)
}

// --- Internal Cache for Cornerstone ---
const prefetchedImageCache = new Map<string, ArrayBuffer>();

// --- DICOM Parsing Logic ---

/**
 * Maps dcmjs internal 'Value' arrays to our Metadata interface.
 * dcmjs stores data as: dict['TAG'].Value = [val1, val2]
 * Note: This is a simplified version; the full extraction is done in prefetchSeriesMetadata.ts
 */
function mapDictToMetadata(dict: any): ExtractedSeriesMetadata {
  const getV = (tag: string) => {
    const el = dict[tag];
    if (!el || el.Value === undefined || el.Value === null) return undefined;
    return Array.isArray(el.Value) ? el.Value[0] : el.Value;
  };

  const getArr = (tag: string): number[] | undefined => {
    const el = dict[tag];
    if (!el || !Array.isArray(el.Value)) return undefined;
    return el.Value.map((v: any) => (typeof v === 'number' ? v : parseFloat(v)));
  };

  const metadata: ExtractedSeriesMetadata = {
    // Image Pixel Module
    Rows: getV('00280010'),
    Columns: getV('00280011'),
    BitsAllocated: getV('00280100'),
    BitsStored: getV('00280101'),
    HighBit: getV('00280102'),
    PixelRepresentation: getV('00280103'),
    SamplesPerPixel: getV('00280002'),
    PhotometricInterpretation: getV('00280004'),
    PlanarConfiguration: getV('00280006'),
    PixelAspectRatio: getV('00280034'),
    SmallestPixelValue: getV('00280106'),
    LargestPixelValue: getV('00280107'),

    // Image Plane Module
    PixelSpacing: getArr('00280030'),
    ImagerPixelSpacing: getArr('00181164'),
    ImageOrientationPatient: getArr('00200037'),
    ImagePositionPatient: getArr('00200032'),
    SliceThickness: getV('00180050'),
    SpacingBetweenSlices: getV('00180088'),
    SliceLocation: getV('00201041'),

    // VOI LUT Module
    RescaleIntercept: getV('00281052'),
    RescaleSlope: getV('00281053'),
    RescaleType: getV('00281054'),
    VOILUTFunction: getV('00281056'),

    // Frame of Reference
    FrameOfReferenceUID: getV('00200052'),

    // Multi-frame
    NumberOfFrames: getV('00280008'),
    FrameTime: getV('00181063'),
    FrameIncrementPointer: getV('00280009'),

    // Image Identification
    ImageType: getArr('00080008') as unknown as string[],
    AcquisitionNumber: getV('00200012'),
    AcquisitionDate: getV('00080022'),
    AcquisitionTime: getV('00080032'),
    InstanceNumber: getV('00200013'),

    // Lossy compression
    LossyImageCompression: getV('00282110'),
    LossyImageCompressionRatio: getV('00282112'),
    LossyImageCompressionMethod: getV('00282114'),

    // PET specific
    CorrectedImage: getArr('00280051') as unknown as string[],
    Units: getV('00541001'),
    DecayCorrection: getV('00541102'),
    FrameReferenceTime: getV('00541300'),
    ActualFrameDuration: getV('00181242'),
  };

  const wc = getArr('00281050');
  const ww = getArr('00281051');
  if (wc) metadata.WindowCenter = wc.length === 1 ? wc[0] : wc;
  if (ww) metadata.WindowWidth = ww.length === 1 ? ww[0] : ww;

  return metadata;
}

/**
 * Robustly parses a buffer by stripping residual headers and
 * choosing the correct dcmjs parser.
 */
function extractMetadataFromDicomBuffer(arrayBuffer: ArrayBuffer): ExtractedSeriesMetadata {
  let uint8Array = new Uint8Array(arrayBuffer);

  // 1. Emergency Header Strip: In case multipart extraction left residual headers
  const initialText = new TextDecoder().decode(uint8Array.slice(0, 500));
  if (initialText.includes('Content-Type') || initialText.startsWith('--')) {
    console.log('[MADO] Residual headers found in buffer. Stripping...');
    for (let i = 0; i < uint8Array.length - 4; i++) {
      if (uint8Array[i] === 13 && uint8Array[i+1] === 10 && uint8Array[i+2] === 13 && uint8Array[i+3] === 10) {
        uint8Array = uint8Array.slice(i + 4);
        break;
      }
    }
  }

  // Defer parsing to the robust implementation in prefetchSeriesMetadata (loaded at runtime)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const prefetchModule = require('./prefetchSeriesMetadata') as any;
    if (prefetchModule && typeof prefetchModule.extractMetadataFromDicomBuffer === 'function') {
      return prefetchModule.extractMetadataFromDicomBuffer(uint8Array.buffer);
    }
  } catch (err) {
    console.warn('[MADO] Failed to load robust parser from prefetchSeriesMetadata:', err);
  }

  throw new Error('No robust DICOM parser available');
}

/**
 * Strips multipart boundaries to get the first application/dicom part.
 */
function extractFirstPartFromMultipart(arrayBuffer: ArrayBuffer, contentType: string): ArrayBuffer | null {
  const boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);
  if (!boundaryMatch) return null;
  const boundary = '--' + boundaryMatch[1];
  const uint8Array = new Uint8Array(arrayBuffer);
  const boundaryBytes = new TextEncoder().encode(boundary);

  let startIdx = -1;
  for (let i = 0; i < uint8Array.length - boundaryBytes.length; i++) {
    let found = true;
    for (let j = 0; j < boundaryBytes.length; j++) {
      if (uint8Array[i + j] !== boundaryBytes[j]) { found = false; break; }
    }
    if (found) { startIdx = i + boundaryBytes.length; break; }
  }
  if (startIdx === -1) return null;

  let dataStart = -1;
  for (let i = startIdx; i < uint8Array.length - 3; i++) {
    if (uint8Array[i] === 13 && uint8Array[i+1] === 10 && uint8Array[i+2] === 13 && uint8Array[i+3] === 10) {
      dataStart = i + 4;
      break;
    }
  }
  if (dataStart === -1) return null;

  let dataEnd = uint8Array.length;
  for (let i = dataStart; i < uint8Array.length - boundaryBytes.length; i++) {
    let found = true;
    for (let j = 0; j < boundaryBytes.length; j++) {
      if (uint8Array[i + j] !== boundaryBytes[j]) { found = false; break; }
    }
    if (found) { dataEnd = i; break; }
  }
  return arrayBuffer.slice(dataStart, dataEnd);
}

// --- High Level API ---

async function fetchAndExtractSeriesMetadata(
  displaySet: MadoDisplaySet,
  options: MadoMetadataOptions
): Promise<ExtractedSeriesMetadata | null> {
  const { studyInstanceUID, seriesInstanceUID, instances } = displaySet;
  if (!instances?.length) return null;

  const firstInstance = instances[0];

  // Use injected client if present; otherwise attempt to construct a minimal one
  // from provided dicomWebConfig / wadoRoot and optional authorization header.
  let client: api.DICOMwebClient | undefined = options.dicomWebClient;
  if (!client) {
    try {
      const headers = typeof options.getAuthorizationHeader === 'function'
        ? options.getAuthorizationHeader()
        : undefined;
      const cfg: any = {
        // prefer explicit wadoRoot from dicomWebConfig, fallback to top-level wadoRoot
        url: options.dicomWebConfig?.wadoRoot || options.dicomWebConfig?.wadoUri || options.wadoRoot,
      };
      if (!cfg.url) {
        throw new Error('[MADO] dicomWebClient or dicomWebConfig.wadoRoot/wadoUri or options.wadoRoot is required for binary metadata extraction (option A)');
      }
      if (headers) cfg.headers = headers;
      client = new api.DICOMwebClient(cfg);
      // cache back on options for downstream helpers
      (options as any).dicomWebClient = client;
    } catch (err) {
      console.warn('[MADO] Failed to construct dicomWebClient for fetchAndExtractSeriesMetadata; will abort binary fetch:', err);
    }
  }

  try {
    if (!client) {
      throw new Error('[MADO] dicomWebClient is required for binary metadata extraction (option A)');
    }

    // Use dicomweb-client which handles multipart/related and headers for us
    // The client may return an ArrayBuffer or an ArrayBuffer wrapped in an array
    const result = await client.retrieveInstance({
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID: firstInstance.sopInstanceUID,
    });

    let buffer: ArrayBuffer | null = null;
    // normalize response
    if (Array.isArray(result)) {
      if (result.length === 0) throw new Error('dicomweb-client returned empty result');
      buffer = result[0] as ArrayBuffer;
    } else if (result instanceof ArrayBuffer) {
      buffer = result;
    } else if (ArrayBuffer.isView(result)) {
      buffer = (result as Uint8Array).buffer;
    } else {
      buffer = (result as any)?.buffer ?? null;
    }

    if (!buffer) return null;

    // Parse the buffer using our robust parser
    const metadata = extractMetadataFromDicomBuffer(buffer);

    // Cache the clean buffer for Cornerstone using the imageId (ensure the same imageId used later)
    try {
      const minimalInstanceForImageId = {
        StudyInstanceUID: studyInstanceUID,
        SeriesInstanceUID: seriesInstanceUID,
        SOPInstanceUID: firstInstance.sopInstanceUID,
        StudyInstanceUid: studyInstanceUID,
        SeriesInstanceUid: seriesInstanceUID,
        SOPInstanceUid: firstInstance.sopInstanceUID,
        sopInstanceUID: firstInstance.sopInstanceUID,
        wadoRoot: instances[0]?.wadoRoot || options.wadoRoot || options.dicomWebConfig?.wadoRoot,
        wadoUri: (instances[0] as any)?.wadoUri || options.dicomWebConfig?.wadoUri || options.dicomWebConfig?.wadoUriRoot,
      };
      const imageId = options.getImageIdsForInstance({ instance: minimalInstanceForImageId, frame: 1 });
      console.log('[MADO] computed imageId for caching:', imageId, minimalInstanceForImageId);
      if (imageId) {
        prefetchedImageCache.set(imageId, buffer);
        prefetchedImageCache.set(`${imageId}/frames/1`, buffer);
      } else {
        console.warn('[MADO] getImageIdsForInstance returned no imageId for minimal instance used for caching', minimalInstanceForImageId);
      }
    } catch (e) {
      // If getImageIdsForInstance fails for some reason, still continue without caching
      console.warn('[MADO] Failed to compute imageId for caching:', e);
    }

    return metadata;
  } catch (err) {
    console.error(`[MADO] Metadata fetch error for series ${seriesInstanceUID}:`, err);
    return null;
  }
}

export async function prefetchSeriesFirstImages(
  displaySets: MadoDisplaySet[],
  options: MadoMetadataOptions
): Promise<Map<string, ExtractedSeriesMetadata>> {
  const metadataMap = new Map<string, ExtractedSeriesMetadata>();
  for (const ds of displaySets) {
    try {
      const meta = await fetchAndExtractSeriesMetadata(ds, options);
      if (meta) metadataMap.set(ds.seriesInstanceUID, meta);
    } catch (e) {
      console.error(`[MADO] Error prefetching ${ds.seriesInstanceUID}:`, e);
    }
  }
  return metadataMap;
}

// Default-exported implementation: retrieveMadoMetadata
export default async function retrieveMadoMetadata(options: MadoMetadataOptions): Promise<void> {
  const {
    displaySets,
    wadoRoot,
    getImageIdsForInstance,
    dicomWebConfig,
    dicomWebClient,
    getAuthorizationHeader,
    madeInClient,
  } = options;

  if (!Array.isArray(displaySets)) {
    throw new Error('retrieveMadoMetadata: displaySets must be an array');
  }

  // Ensure we have a dicomWebClient. If one wasn't injected, attempt to construct
  // a minimal DICOMwebClient from dicomWebConfig + auth headers so callers that
  // haven't initialized the data source client can still use MADO loading.
  let client: api.DICOMwebClient | undefined = dicomWebClient;
  if (!client) {
    try {
      const headers = typeof getAuthorizationHeader === 'function' ? getAuthorizationHeader() : undefined;
      const url = dicomWebConfig?.wadoRoot || dicomWebConfig?.wadoUri || wadoRoot;
      if (!url) {
        console.warn('[MADO] dicomWebClient not provided and no wadoRoot/wadoUri available; proceeding without client');
      } else {
        const cfg: any = { url };
        if (headers) cfg.headers = headers;
        // Construct a dicomweb-client instance
        client = new api.DICOMwebClient(cfg);
        // Update options.dicomWebClient for downstream helpers that read it
        (options as any).dicomWebClient = client;
      }
    } catch (err) {
      console.warn('[MADO] Failed to construct dicomWebClient from config; proceeding without client:', err);
    }
  }

  try {
    // Prefetch first-image metadata for all display sets. This will also cache buffers for later image loads.
    const prefetchOptions = { ...options, dicomWebClient: client } as MadoMetadataOptions;
    const metaMap = await prefetchSeriesFirstImages(displaySets, prefetchOptions);

    console.log('📦 [MADO] Prefetch results:', {
      displaySetCount: displaySets.length,
      metaMapSize: metaMap.size,
      seriesWithMeta: Array.from(metaMap.keys()).map(k => k.substring(0, 20) + '...'),
    });

    for (const ds of displaySets) {
      const seriesMeta = metaMap.get(ds.seriesInstanceUID);

      console.log(`📋 [MADO] Processing series ${ds.seriesInstanceUID.substring(0, 20)}...`, {
        hasSeriesMeta: !!seriesMeta,
        instanceCount: ds.instances?.length,
        metaFields: seriesMeta ? {
          hasRows: !!seriesMeta.Rows,
          hasColumns: !!seriesMeta.Columns,
          hasIPP: !!seriesMeta.ImagePositionPatient,
          hasIOP: !!seriesMeta.ImageOrientationPatient,
          hasPixelSpacing: !!seriesMeta.PixelSpacing,
        } : null,
      });

      // Apply extracted series-level metadata to each instance in the display set
      if (seriesMeta && Array.isArray(ds.instances)) {
        const sliceSpacing = seriesMeta.SpacingBetweenSlices || seriesMeta.SliceThickness || 1.0;
        const orientation = seriesMeta.ImageOrientationPatient || [1, 0, 0, 0, 1, 0];
        const firstPosition = seriesMeta.ImagePositionPatient || [0, 0, 0];
        const rowCos = orientation.slice(0, 3);
        const colCos = orientation.slice(3, 6);
        const sliceNormal = [
          rowCos[1] * colCos[2] - rowCos[2] * colCos[1],
          rowCos[2] * colCos[0] - rowCos[0] * colCos[2],
          rowCos[0] * colCos[1] - rowCos[1] * colCos[0],
        ];

        ds.instances.forEach((instance: any, idx: number) => {
          // set both capitalized and camelCase keys to maximize compatibility with downstream code
          if (seriesMeta.Rows !== undefined) {
            instance.rows = seriesMeta.Rows;
            instance.Rows = seriesMeta.Rows;
          }
          if (seriesMeta.Columns !== undefined) {
            instance.columns = seriesMeta.Columns;
            instance.Columns = seriesMeta.Columns;
          }
          if (seriesMeta.BitsAllocated !== undefined) instance.BitsAllocated = seriesMeta.BitsAllocated;
          if (seriesMeta.BitsStored !== undefined) instance.BitsStored = seriesMeta.BitsStored;
          if (seriesMeta.HighBit !== undefined) instance.HighBit = seriesMeta.HighBit;
          if (seriesMeta.PixelRepresentation !== undefined) instance.PixelRepresentation = seriesMeta.PixelRepresentation;
          if (seriesMeta.SamplesPerPixel !== undefined) {
            instance.SamplesPerPixel = seriesMeta.SamplesPerPixel;
            instance.samplesPerPixel = seriesMeta.SamplesPerPixel;
          }
          if (seriesMeta.PhotometricInterpretation !== undefined) instance.PhotometricInterpretation = seriesMeta.PhotometricInterpretation;
          if (seriesMeta.PlanarConfiguration !== undefined) instance.PlanarConfiguration = seriesMeta.PlanarConfiguration;

          if (seriesMeta.PixelSpacing !== undefined) {
            instance.PixelSpacing = seriesMeta.PixelSpacing;
            instance.pixelSpacing = seriesMeta.PixelSpacing;
          }
          if (seriesMeta.ImageOrientationPatient !== undefined) {
            instance.ImageOrientationPatient = seriesMeta.ImageOrientationPatient;
            instance.imageOrientationPatient = seriesMeta.ImageOrientationPatient;
          }

          // Derive ImagePositionPatient per-slice using slice normal & spacing
          if (seriesMeta.ImagePositionPatient) {
            const offset = idx * sliceSpacing;
            const pos = [
              firstPosition[0] + sliceNormal[0] * offset,
              firstPosition[1] + sliceNormal[1] * offset,
              firstPosition[2] + sliceNormal[2] * offset,
            ];
            instance.ImagePositionPatient = pos;
            instance.imagePositionPatient = pos;
          }

          if (seriesMeta.SliceThickness !== undefined) instance.SliceThickness = instance.sliceThickness = seriesMeta.SliceThickness;
          if (seriesMeta.SpacingBetweenSlices !== undefined) instance.SpacingBetweenSlices = seriesMeta.SpacingBetweenSlices;

          if (seriesMeta.WindowCenter !== undefined) instance.WindowCenter = seriesMeta.WindowCenter;
          if (seriesMeta.WindowWidth !== undefined) instance.WindowWidth = seriesMeta.WindowWidth;
          if (seriesMeta.RescaleIntercept !== undefined) instance.RescaleIntercept = seriesMeta.RescaleIntercept;
          if (seriesMeta.RescaleSlope !== undefined) instance.RescaleSlope = seriesMeta.RescaleSlope;
          if (seriesMeta.RescaleType !== undefined) instance.RescaleType = seriesMeta.RescaleType;
          if (seriesMeta.FrameOfReferenceUID !== undefined) instance.FrameOfReferenceUID = seriesMeta.FrameOfReferenceUID;

          // Palette Color Lookup Table - essential for PALETTE COLOR photometric interpretation
          if (seriesMeta.RedPaletteColorLookupTableDescriptor !== undefined) {
            instance.RedPaletteColorLookupTableDescriptor = seriesMeta.RedPaletteColorLookupTableDescriptor;
            instance.redPaletteColorLookupTableDescriptor = seriesMeta.RedPaletteColorLookupTableDescriptor;
          }
          if (seriesMeta.GreenPaletteColorLookupTableDescriptor !== undefined) {
            instance.GreenPaletteColorLookupTableDescriptor = seriesMeta.GreenPaletteColorLookupTableDescriptor;
            instance.greenPaletteColorLookupTableDescriptor = seriesMeta.GreenPaletteColorLookupTableDescriptor;
          }
          if (seriesMeta.BluePaletteColorLookupTableDescriptor !== undefined) {
            instance.BluePaletteColorLookupTableDescriptor = seriesMeta.BluePaletteColorLookupTableDescriptor;
            instance.bluePaletteColorLookupTableDescriptor = seriesMeta.BluePaletteColorLookupTableDescriptor;
          }
          if (seriesMeta.RedPaletteColorLookupTableData !== undefined) {
            instance.RedPaletteColorLookupTableData = seriesMeta.RedPaletteColorLookupTableData;
            instance.redPaletteColorLookupTableData = seriesMeta.RedPaletteColorLookupTableData;
          }
          if (seriesMeta.GreenPaletteColorLookupTableData !== undefined) {
            instance.GreenPaletteColorLookupTableData = seriesMeta.GreenPaletteColorLookupTableData;
            instance.greenPaletteColorLookupTableData = seriesMeta.GreenPaletteColorLookupTableData;
          }
          if (seriesMeta.BluePaletteColorLookupTableData !== undefined) {
            instance.BluePaletteColorLookupTableData = seriesMeta.BluePaletteColorLookupTableData;
            instance.bluePaletteColorLookupTableData = seriesMeta.BluePaletteColorLookupTableData;
          }
          if (seriesMeta.PaletteColorLookupTableUID !== undefined) {
            instance.PaletteColorLookupTableUID = seriesMeta.PaletteColorLookupTableUID;
            instance.paletteColorLookupTableUID = seriesMeta.PaletteColorLookupTableUID;
          }

          // Segmented Palette Color Lookup Table copy (0028,1221-1223)
          if (seriesMeta.SegmentedRedPaletteColorLookupTableData !== undefined) {
            instance.SegmentedRedPaletteColorLookupTableData = seriesMeta.SegmentedRedPaletteColorLookupTableData;
            instance.segmentedRedPaletteColorLookupTableData = seriesMeta.SegmentedRedPaletteColorLookupTableData;
          }
          if (seriesMeta.SegmentedGreenPaletteColorLookupTableData !== undefined) {
            instance.SegmentedGreenPaletteColorLookupTableData = seriesMeta.SegmentedGreenPaletteColorLookupTableData;
            instance.segmentedGreenPaletteColorLookupTableData = seriesMeta.SegmentedGreenPaletteColorLookupTableData;
          }
          if (seriesMeta.SegmentedBluePaletteColorLookupTableData !== undefined) {
            instance.SegmentedBluePaletteColorLookupTableData = seriesMeta.SegmentedBluePaletteColorLookupTableData;
            instance.segmentedBluePaletteColorLookupTableData = seriesMeta.SegmentedBluePaletteColorLookupTableData;
          }

          // NEW: Additional metadata fields for complete DICOM-JSON parity

          // Pixel module extras
          if (seriesMeta.PixelAspectRatio !== undefined) instance.PixelAspectRatio = seriesMeta.PixelAspectRatio;
          if (seriesMeta.SmallestPixelValue !== undefined) instance.SmallestPixelValue = seriesMeta.SmallestPixelValue;
          if (seriesMeta.LargestPixelValue !== undefined) instance.LargestPixelValue = seriesMeta.LargestPixelValue;

          // Image plane extras
          if (seriesMeta.ImagerPixelSpacing !== undefined) {
            instance.ImagerPixelSpacing = seriesMeta.ImagerPixelSpacing;
            instance.imagerPixelSpacing = seriesMeta.ImagerPixelSpacing;
          }
          if (seriesMeta.SliceLocation !== undefined) {
            // Calculate per-slice SliceLocation if we have the first slice's value
            const baseSliceLocation = seriesMeta.SliceLocation;
            instance.SliceLocation = baseSliceLocation + idx * sliceSpacing;
            instance.sliceLocation = instance.SliceLocation;
          }

          // VOI LUT extras
          if (seriesMeta.VOILUTFunction !== undefined) instance.VOILUTFunction = seriesMeta.VOILUTFunction;

          // Multi-frame extras
          if (seriesMeta.FrameTime !== undefined) instance.FrameTime = seriesMeta.FrameTime;
          if (seriesMeta.FrameIncrementPointer !== undefined) instance.FrameIncrementPointer = seriesMeta.FrameIncrementPointer;
          if (seriesMeta.NumberOfFrames !== undefined) {
            instance.NumberOfFrames = seriesMeta.NumberOfFrames;
            instance.numberOfFrames = seriesMeta.NumberOfFrames;
          }
          if (seriesMeta.PerFrameFunctionalGroupsSequence !== undefined) {
            instance.PerFrameFunctionalGroupsSequence = seriesMeta.PerFrameFunctionalGroupsSequence;
          }
          if (seriesMeta.SharedFunctionalGroupsSequence !== undefined) {
            instance.SharedFunctionalGroupsSequence = seriesMeta.SharedFunctionalGroupsSequence;
          }

          // Image identification
          if (seriesMeta.ImageType !== undefined) instance.ImageType = seriesMeta.ImageType;
          if (seriesMeta.AcquisitionNumber !== undefined) instance.AcquisitionNumber = seriesMeta.AcquisitionNumber;
          if (seriesMeta.AcquisitionDate !== undefined) instance.AcquisitionDate = seriesMeta.AcquisitionDate;
          if (seriesMeta.AcquisitionTime !== undefined) instance.AcquisitionTime = seriesMeta.AcquisitionTime;

          // Lossy compression info
          if (seriesMeta.LossyImageCompression !== undefined) instance.LossyImageCompression = seriesMeta.LossyImageCompression;
          if (seriesMeta.LossyImageCompressionRatio !== undefined) instance.LossyImageCompressionRatio = seriesMeta.LossyImageCompressionRatio;
          if (seriesMeta.LossyImageCompressionMethod !== undefined) instance.LossyImageCompressionMethod = seriesMeta.LossyImageCompressionMethod;

          // Ultrasound calibration sequence
          if (seriesMeta.SequenceOfUltrasoundRegions !== undefined) {
            instance.SequenceOfUltrasoundRegions = seriesMeta.SequenceOfUltrasoundRegions;
          }

          // PET specific fields
          if (seriesMeta.CorrectedImage !== undefined) instance.CorrectedImage = seriesMeta.CorrectedImage;
          if (seriesMeta.Units !== undefined) instance.Units = seriesMeta.Units;
          if (seriesMeta.DecayCorrection !== undefined) instance.DecayCorrection = seriesMeta.DecayCorrection;
          if (seriesMeta.FrameReferenceTime !== undefined) instance.FrameReferenceTime = seriesMeta.FrameReferenceTime;
          if (seriesMeta.ActualFrameDuration !== undefined) instance.ActualFrameDuration = seriesMeta.ActualFrameDuration;
          if (seriesMeta.RadiopharmaceuticalInformationSequence !== undefined) {
            instance.RadiopharmaceuticalInformationSequence = seriesMeta.RadiopharmaceuticalInformationSequence;
          }

          // Mark that this instance has prefetched metadata so synthesis gives it priority
          instance._prefetchedMetadata = true;

          // CRITICAL: Mark geometry as patched if we have valid geometry from prefetched metadata
          // This allows 3D reconstruction to work without waiting for images to load in viewport
          const hasValidGeometry =
            instance.Rows && instance.Columns &&
            Array.isArray(instance.ImagePositionPatient) && instance.ImagePositionPatient.length === 3 &&
            Array.isArray(instance.ImageOrientationPatient) && instance.ImageOrientationPatient.length === 6 &&
            Array.isArray(instance.PixelSpacing) && instance.PixelSpacing.length === 2;

          if (hasValidGeometry) {
            instance._geometryPatched = true;
            console.log(`✅ [MADO] Instance ${idx} marked _geometryPatched=true`, {
              Rows: instance.Rows,
              Columns: instance.Columns,
              IPP: instance.ImagePositionPatient,
              IOP: instance.ImageOrientationPatient?.slice(0, 3),
              PixelSpacing: instance.PixelSpacing,
            });
          } else {
            console.warn(`⚠️ [MADO] Instance ${idx} missing geometry fields:`, {
              Rows: instance.Rows,
              Columns: instance.Columns,
              hasIPP: !!instance.ImagePositionPatient,
              hasIOP: !!instance.ImageOrientationPatient,
              hasPixelSpacing: !!instance.PixelSpacing,
            });
          }

          // Ensure wadoRoot/wadoUri markers are present for downstream synthesis
          instance.wadoRoot = instance.wadoRoot || wadoRoot;
          instance.wadoUri = instance.wadoUri || dicomWebConfig?.wadoUri;

          // Ensure UID fields are present on the instance object so imageId builders have what they need
          instance.StudyInstanceUID = instance.StudyInstanceUID || ds.studyInstanceUID;
          instance.SeriesInstanceUID = instance.SeriesInstanceUID || ds.seriesInstanceUID;
          instance.SOPInstanceUID = instance.SOPInstanceUID || instance.sopInstanceUID || instance.SOPInstanceUID;
          instance.studyInstanceUID = instance.studyInstanceUID || ds.studyInstanceUID;
          instance.seriesInstanceUID = instance.seriesInstanceUID || ds.seriesInstanceUID;
          instance.sopInstanceUID = instance.sopInstanceUID || instance.SOPInstanceUID || instance.SOPInstanceUid;
        });
      }

      // Synthesize and store series + instances into the DicomMetadataStore
      try {
        const synthesizedSeries = synthesizeSeriesMetadata(ds);
        DicomMetadataStore.addSeriesMetadata([synthesizedSeries], madeInClient);

        const synthesizedInstances: any[] = [];
        if (Array.isArray(ds.instances)) {
          ds.instances.forEach((instance: any, idx: number) => {
            const instanceForImageId = {
              ...instance,
              StudyInstanceUID: ds.studyInstanceUID,
              SeriesInstanceUID: ds.seriesInstanceUID,
              studyInstanceUID: ds.studyInstanceUID,
              seriesInstanceUID: ds.seriesInstanceUID,
            };
            const imageId = getImageIdsForInstance({ instance: instanceForImageId });
            const synthesized = synthesizeInstanceMetadata(ds, instance, {
               wadoRoot: instance.wadoRoot || wadoRoot || (dicomWebConfig && dicomWebConfig.wadoRoot) || '',
               wadoUri: instance.wadoUri || dicomWebConfig?.wadoUri || '',
               imageId,
               index: idx,
             });
            synthesizedInstances.push(synthesized);

            // Register imageId to UIDs in MetadataProvider (again for the synthesized object)
            try {
              const numberOfFrames = instance.NumberOfFrames || instance.numberOfFrames || 1;
              for (let f = 1; f <= numberOfFrames; f++) {
                const frameImageId = getImageIdsForInstance({ instance, frame: numberOfFrames > 1 ? f : undefined });
                if (frameImageId) {
                  metadataProvider.addImageIdToUIDs(frameImageId, {
                    StudyInstanceUID: ds.studyInstanceUID,
                    SeriesInstanceUID: ds.seriesInstanceUID,
                    SOPInstanceUID: instance.sopInstanceUID || instance.SOPInstanceUID,
                    frameNumber: numberOfFrames > 1 ? f : undefined,
                  });
                }
              }
            } catch (err) {
              // ignore
            }
          });
        }

        if (synthesizedInstances.length) {
          DicomMetadataStore.addInstances(synthesizedInstances, madeInClient);
        }
      } catch (err) {
        console.error('[MADO] Error synthesizing/storing metadata for series', ds.seriesInstanceUID, err);
      }
    }
  } catch (err) {
    console.error('[MADO] retrieveMadoMetadata failed:', err);
    throw err;
  }
}

import dcmjs from 'dcmjs';
import type { MadoDisplaySet, MadoInstance } from './MadoParser';
import { data } from 'dcmjs';
const { DicomDict, DicomMetaDictionary } = data;

const { DicomMessage } = dcmjs.data;

/**
 * Metadata extracted from the first image of a series.
 * This is used to seed accurate metadata for all images in the series.
 */
export interface ExtractedSeriesMetadata {
  // Image pixel module
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

  // Image plane module
  PixelSpacing?: number[];
  ImagerPixelSpacing?: number[];
  ImageOrientationPatient?: number[];
  ImagePositionPatient?: number[];
  SliceThickness?: number;
  SpacingBetweenSlices?: number;
  SliceLocation?: number;

  // Window/Level
  WindowCenter?: number | number[];
  WindowWidth?: number | number[];
  RescaleIntercept?: number;
  RescaleSlope?: number;
  RescaleType?: string;
  VOILUTFunction?: string;

  // Frame of reference
  FrameOfReferenceUID?: string;

  // Multi-frame support
  NumberOfFrames?: number;
  PerFrameFunctionalGroupsSequence?: any[];
  SharedFunctionalGroupsSequence?: any[];
  FrameTime?: number;
  FrameIncrementPointer?: string;

  // Transfer syntax
  TransferSyntaxUID?: string;

  // Image identification
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

  // Segmented Palette Color Lookup Table (0028,1221-1223)
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

/**
 * HELPER: Maps a raw dcmjs dictionary to your ExtractedSeriesMetadata interface.
 * This prevents the massive code duplication in your original file.
 */
function mapDictToMetadata(dict: any): ExtractedSeriesMetadata {
  // Build a normalized lookup: map normalized 8-hex tag -> element
  const normalizedLookup: Record<string, any> = {};
  try {
    for (const k of Object.keys(dict || {})) {
      // Extract hex digits from the key
      const hex = (k || '').toString().toUpperCase().replace(/[^0-9A-F]/g, '');
      // Use the last 8 chars (group+element) if present
      const norm = hex.length >= 8 ? hex.slice(-8) : hex.padStart(8, '0');
      normalizedLookup[norm] = dict[k];
    }
  } catch (e) {
    // ignore
  }

  const parsePossiblyNumeric = (v: any) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : v;
    }
    return v;
  };

  const findElement = (tag: string) => {
    // tag expected like '00280010'
    if (!tag) return undefined;
    const t = tag.toUpperCase();
    if (dict && dict[t]) return dict[t];
    if (normalizedLookup[t]) return normalizedLookup[t];
    // try with leading 'X'
    if (dict && dict['x' + t.toLowerCase()]) return dict['x' + t.toLowerCase()];
    // fallback: scan keys for ending with tag
    for (const k of Object.keys(dict || {})) {
      const kk = k.toUpperCase();
      if (kk.endsWith(t)) return dict[k];
    }
    return undefined;
  };

  const getValue = (tag: string, index = 0) => {
    const element = findElement(tag);
    if (!element || element.Value === undefined || element.Value === null) return undefined;
    const val = Array.isArray(element.Value) ? element.Value[index] : element.Value;
    return parsePossiblyNumeric(val);
  };

  const getArray = (tag: string): number[] | undefined => {
    const element = findElement(tag);
    if (!element || element.Value === undefined || element.Value === null) return undefined;

    const v = element.Value;

    // Handle TypedArrays directly (if Value is just the array)
    if (ArrayBuffer.isView(v)) {
      return Array.from(v as any);
    }

    if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' && v[0].includes('\\')) {
      return v[0].split('\\').map((s: string) => parseFloat(s)).filter((n: number) => Number.isFinite(n));
    }

    if (Array.isArray(v)) {
      // Handle case where Value contains a single TypedArray or ArrayBuffer (common in dcmjs for OW/OB)
      if (v.length === 1) {
        if (ArrayBuffer.isView(v[0])) {
          return Array.from(v[0] as any);
        }
        if (v[0] instanceof ArrayBuffer) {
          const vr = element.vr;
          // OW is 16-bit words
          if ((vr === 'OW' || vr === 'US' || vr === 'SS') && v[0].byteLength % 2 === 0) {
            return Array.from(new Uint16Array(v[0]));
          }
          // Default to byte array
          return Array.from(new Uint8Array(v[0]));
        }
      }

      const out = v.map((x: any) => (typeof x === 'number' ? x : typeof x === 'string' ? parseFloat(x) : undefined)).filter((n: any) => n !== undefined);
      return out.length ? out : undefined;
    }

    if (typeof v === 'string' && v.includes('\\')) {
      const out = v.split('\\').map((s: string) => parseFloat(s)).filter((n: number) => Number.isFinite(n));
      return out.length ? out : undefined;
    }

    return undefined;
  };

  const metadata: ExtractedSeriesMetadata = {
    // Image Pixel Module
    Rows: getValue('00280010'),
    Columns: getValue('00280011'),
    BitsAllocated: getValue('00280100'),
    BitsStored: getValue('00280101'),
    HighBit: getValue('00280102'),
    PixelRepresentation: getValue('00280103'),
    SamplesPerPixel: getValue('00280002'),
    PhotometricInterpretation: getValue('00280004'),
    PlanarConfiguration: getValue('00280006'),
    PixelAspectRatio: getValue('00280034'),
    SmallestPixelValue: getValue('00280106'),
    LargestPixelValue: getValue('00280107'),

    // Image Plane Module
    PixelSpacing: getArray('00280030'),
    ImagerPixelSpacing: getArray('00181164'),
    ImageOrientationPatient: getArray('00200037'),
    ImagePositionPatient: getArray('00200032'),
    SliceThickness: getValue('00180050'),
    SpacingBetweenSlices: getValue('00180088'),
    SliceLocation: getValue('00201041'),

    // VOI LUT Module
    RescaleIntercept: getValue('00281052'),
    RescaleSlope: getValue('00281053'),
    RescaleType: getValue('00281054'),
    VOILUTFunction: getValue('00281056'),

    // Frame of Reference
    FrameOfReferenceUID: getValue('00200052'),

    // Multi-frame
    NumberOfFrames: getValue('00280008'),
    FrameTime: getValue('00181063'),
    FrameIncrementPointer: getValue('00280009'),

    // Image Identification
    ImageType: getArray('00080008') as unknown as string[],
    AcquisitionNumber: getValue('00200012'),
    AcquisitionDate: getValue('00080022'),
    AcquisitionTime: getValue('00080032'),
    InstanceNumber: getValue('00200013'),

    // Lossy compression info
    LossyImageCompression: getValue('00282110'),
    LossyImageCompressionRatio: getValue('00282112'),
    LossyImageCompressionMethod: getValue('00282114'),

    // Palette Color Lookup Table
    RedPaletteColorLookupTableDescriptor: getArray('00281101'),
    GreenPaletteColorLookupTableDescriptor: getArray('00281102'),
    BluePaletteColorLookupTableDescriptor: getArray('00281103'),
    RedPaletteColorLookupTableData: getArray('00281201'),
    GreenPaletteColorLookupTableData: getArray('00281202'),
    BluePaletteColorLookupTableData: getArray('00281203'),
    PaletteColorLookupTableUID: getValue('00281199'),

    // Segmented Palette Color Lookup Table
    SegmentedRedPaletteColorLookupTableData: getArray('00281221'),
    SegmentedGreenPaletteColorLookupTableData: getArray('00281222'),
    SegmentedBluePaletteColorLookupTableData: getArray('00281223'),

    // PET specific
    CorrectedImage: getArray('00280051') as unknown as string[],
    Units: getValue('00541001'),
    DecayCorrection: getValue('00541102'),
    FrameReferenceTime: getValue('00541300'),
    ActualFrameDuration: getValue('00181242'),
  };

  // Handle Ultrasound calibration sequence - get raw sequence value
  const usRegionsElement = findElement('00186011');
  if (usRegionsElement?.Value) {
    metadata.SequenceOfUltrasoundRegions = usRegionsElement.Value;
  }

  // Handle Radiopharmaceutical sequence for PET
  const radioSeqElement = findElement('00540016');
  if (radioSeqElement?.Value) {
    metadata.RadiopharmaceuticalInformationSequence = radioSeqElement.Value;
  }

  // Handle PerFrameFunctionalGroupsSequence for enhanced DICOM
  const perFrameElement = findElement('52009230');
  if (perFrameElement?.Value) {
    metadata.PerFrameFunctionalGroupsSequence = perFrameElement.Value;
  }

  // Handle SharedFunctionalGroupsSequence for enhanced DICOM
  const sharedFGElement = findElement('52009229');
  if (sharedFGElement?.Value) {
    metadata.SharedFunctionalGroupsSequence = sharedFGElement.Value;
  }

  // Handle Window Center/Width (can be single value or array)
  const wc = getArray('00281050');
  const ww = getArray('00281051');
  if (wc) metadata.WindowCenter = wc.length === 1 ? wc[0] : wc;
  if (ww) metadata.WindowWidth = ww.length === 1 ? ww[0] : ww;

  // Log palette color data if found
  if (metadata.RedPaletteColorLookupTableDescriptor) {
    console.log('[MADO] mapDictToMetadata found palette color data:', {
      redDescriptor: metadata.RedPaletteColorLookupTableDescriptor,
      greenDescriptor: metadata.GreenPaletteColorLookupTableDescriptor,
      blueDescriptor: metadata.BluePaletteColorLookupTableDescriptor,
      redDataLength: metadata.RedPaletteColorLookupTableData?.length,
      greenDataLength: metadata.GreenPaletteColorLookupTableData?.length,
      blueDataLength: metadata.BluePaletteColorLookupTableData?.length,
      uid: metadata.PaletteColorLookupTableUID,
    });
  }
  // Log segmented palette data presence
  if (metadata.SegmentedRedPaletteColorLookupTableData) {
    console.log('[MADO Prefetch] ✅ Found segmented palette color data:', {
      redSegmentedLength: metadata.SegmentedRedPaletteColorLookupTableData?.length,
      greenSegmentedLength: metadata.SegmentedGreenPaletteColorLookupTableData?.length,
      blueSegmentedLength: metadata.SegmentedBluePaletteColorLookupTableData?.length,
    });
  }

  // Diagnostic logging for empty mappings
  if (!metadata.Rows && !metadata.Columns && !metadata.PixelSpacing) {
    try {
      const sampleTags = Object.keys(dict).slice(0, 20);
      console.warn('[MADO] mapDictToMetadata produced empty core fields, sample tags:', sampleTags);
      console.warn('[MADO] Normalized keys (sample):', Object.keys(normalizedLookup).slice(0, 20));
      sampleTags.forEach((t) => {
        try {
          const el = dict[t];
          console.warn(`[MADO] tag ${t} =>`, el && el.Value ? el.Value.slice ? el.Value.slice(0,3) : el.Value : el);
        } catch (e) {
          /* ignore */
        }
      });
    } catch (e) {
      /* ignore */
    }
  }

  return metadata;
}

/**
 * Cache for prefetched image ArrayBuffers, keyed by imageId.
 * This allows reusing the fetched data when the actual image load happens.
 */
const prefetchedImageCache = new Map<string, ArrayBuffer>();

/**
 * Get a prefetched image from cache
 */
export function getPrefetchedImage(imageId: string): ArrayBuffer | undefined {
  return prefetchedImageCache.get(imageId);
}

/**
 * Check if an image is prefetched
 */
export function hasPrefetchedImage(imageId: string): boolean {
  return prefetchedImageCache.has(imageId);
}

/**
 * Clear a specific prefetched image from cache
 */
export function clearPrefetchedImage(imageId: string): void {
  prefetchedImageCache.delete(imageId);
}

/**
 * Clear all prefetched images from cache
 */
export function clearAllPrefetchedImages(): void {
  prefetchedImageCache.clear();
}

/**
 * Extracts the first DICOM part from a multipart response.
 * This handles the boundary parsing for multipart/related responses.
 */
function extractFirstPartFromMultipart(arrayBuffer: ArrayBuffer, contentType: string): ArrayBuffer | null {
  try {
    // Extract boundary from content-type header
    const boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);
    if (!boundaryMatch) {
      console.warn('[MADO Prefetch] Could not extract boundary from multipart response');
      return null;
    }

    const boundary = '--' + boundaryMatch[1];
    const uint8Array = new Uint8Array(arrayBuffer);

    // Find the first boundary
    let startIdx = 0;
    const boundaryBytes = new TextEncoder().encode(boundary);

    // Search for first boundary
    for (let i = 0; i < uint8Array.length - boundaryBytes.length; i++) {
      let found = true;
      for (let j = 0; j < boundaryBytes.length; j++) {
        if (uint8Array[i + j] !== boundaryBytes[j]) {
          found = false;
          break;
        }
      }
      if (found) {
        startIdx = i + boundaryBytes.length;
        break;
      }
    }

    // Skip past CRLF or LF after boundary
    if (uint8Array[startIdx] === 13 && uint8Array[startIdx + 1] === 10) {
      startIdx += 2;
    } else if (uint8Array[startIdx] === 10) {
      startIdx += 1;
    }

    // Skip headers until we find empty line (CRLF CRLF or LF LF)
    // This handles Content-Type, Content-Length, MIME-Version, etc.
    let dataStart = startIdx;
    for (let i = startIdx; i < uint8Array.length - 3; i++) {
      // Check for CRLF CRLF
      if (uint8Array[i] === 13 && uint8Array[i + 1] === 10 &&
          uint8Array[i + 2] === 13 && uint8Array[i + 3] === 10) {
        dataStart = i + 4;
        break;
      }
      // Check for LF LF (some servers use just LF)
      if (uint8Array[i] === 10 && uint8Array[i + 1] === 10) {
        dataStart = i + 2;
        break;
      }
    }

    console.log(`[MADO Prefetch] Multipart data starts at byte ${dataStart} (skipped ${dataStart - startIdx} bytes of headers)`);

    // Find the next boundary (end of first part)
    let dataEnd = uint8Array.length;
    for (let i = dataStart; i < uint8Array.length - boundaryBytes.length; i++) {
      let found = true;
      for (let j = 0; j < boundaryBytes.length; j++) {
        if (uint8Array[i + j] !== boundaryBytes[j]) {
          found = false;
          break;
        }
      }
      if (found) {
        // Go back to skip CRLF or LF before boundary
        dataEnd = i;
        if (dataEnd >= 2 && uint8Array[dataEnd - 2] === 13 && uint8Array[dataEnd - 1] === 10) {
          dataEnd = dataEnd - 2;
        } else if (dataEnd >= 1 && uint8Array[dataEnd - 1] === 10) {
          dataEnd = dataEnd - 1;
        }
        break;
      }
    }

    if (dataEnd <= dataStart) {
      console.warn('[MADO Prefetch] Could not find valid data in multipart response');
      return null;
    }

    console.log(`[MADO Prefetch] Extracted ${dataEnd - dataStart} bytes from multipart response`);

    // Log first few bytes to help debug
    const firstBytes = Array.from(uint8Array.slice(dataStart, Math.min(dataStart + 16, dataEnd)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
    console.log(`[MADO Prefetch] First 16 bytes: ${firstBytes}`);

    return arrayBuffer.slice(dataStart, dataEnd);
  } catch (error) {
    console.error('[MADO Prefetch] Error parsing multipart response:', error);
    return null;
  }
}

/**
 * Lightweight fallback parser for implicit VR little-endian datasets.
 * Scans the ArrayBuffer for elements and extracts a small set of useful tags.
 */
function parseImplicitVrLittleEndianForCommonTags(arrayBuffer: ArrayBuffer): ExtractedSeriesMetadata | null {
  try {
    const dv = new DataView(arrayBuffer);
    const littleEndian = true;
    const len = arrayBuffer.byteLength;
    let offset = 0;
    const metadata: Partial<ExtractedSeriesMetadata> = {};

    const readString = (start: number, length: number) => {
      const bytes = new Uint8Array(arrayBuffer, start, Math.max(0, Math.min(length, len - start)));
      let s = '';
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === 0) break;
        s += String.fromCharCode(b);
      }
      return s.trim();
    };

    const readWords = (start: number, length: number) => {
      // length is in bytes
      const numWords = Math.floor(length / 2);
      const words = new Uint16Array(numWords);
      for (let i = 0; i < numWords; i++) {
        words[i] = dv.getUint16(start + i * 2, littleEndian);
      }
      return Array.from(words);
    };

    const toNumberArray = (raw: string | undefined) => {
      if (!raw) return undefined;
      const parts = raw.split('\\').map(p => p.trim()).filter(p => p !== '');
      const nums = parts.map(p => {
        const n = parseFloat(p);
        return Number.isFinite(n) ? n : undefined;
      }).filter(x => x !== undefined) as number[];
      return nums.length > 0 ? nums : undefined;
    };

    // Helper to check if two bytes look like ASCII letters (VR)
    const isAsciiLetters = (b1: number, b2: number) => {
      const isLetter = (b: number) => (b >= 65 && b <= 90) || (b >= 97 && b <= 122);
      return isLetter(b1) && isLetter(b2);
    };

    while (offset + 8 <= len) {
      // Read tag (group and element)
      const group = dv.getUint16(offset, littleEndian);
      const element = dv.getUint16(offset + 2, littleEndian);
      const tag = group.toString(16).padStart(4, '0') + element.toString(16).padStart(4, '0');
      offset += 4;

      if (offset + 4 > len) break;

      // Determine explicit vs implicit VR by peeking next two bytes
      let valueLength = 0;
      let vr: string | null = null;
      if (offset + 2 <= len && isAsciiLetters(dv.getUint8(offset), dv.getUint8(offset + 1))) {
        // Explicit VR
        vr = String.fromCharCode(dv.getUint8(offset)) + String.fromCharCode(dv.getUint8(offset + 1));
        offset += 2; // consume VR

        // VRs with 2 reserved bytes and 32-bit length
        const longVRs = new Set(['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN']);
        if (longVRs.has(vr)) {
          // Skip 2 reserved bytes
          offset += 2;
          if (offset + 4 > len) break;
          valueLength = dv.getUint32(offset, littleEndian);
          offset += 4;
        } else {
          // 16-bit length
          if (offset + 2 > len) break;
          valueLength = dv.getUint16(offset, littleEndian);
          offset += 2;
        }
      } else {
        // Implicit VR: 32-bit length follows
        valueLength = dv.getUint32(offset, littleEndian);
        offset += 4;
      }

      if (valueLength < 0 || offset + valueLength > len) {
        // malformed length; bail out
        break;
      }

      const raw = readString(offset, valueLength);

      switch (tag) {
        case '00280010': // Rows
          metadata.Rows = parseInt(raw, 10);
          break;
        case '00280011': // Columns
          metadata.Columns = parseInt(raw, 10);
          break;
        case '00280002': // SamplesPerPixel
          metadata.SamplesPerPixel = parseInt(raw, 10);
          break;
        case '00280004': // PhotometricInterpretation
          metadata.PhotometricInterpretation = raw;
          break;
        case '00280030': // PixelSpacing
          metadata.PixelSpacing = toNumberArray(raw);
          break;
        case '00200037': // ImageOrientationPatient
          metadata.ImageOrientationPatient = toNumberArray(raw);
          break;
        case '00200032': // ImagePositionPatient
          metadata.ImagePositionPatient = toNumberArray(raw);
          break;
        case '00180050': // SliceThickness
          metadata.SliceThickness = parseFloat(raw);
          break;
        case '00180088': // SpacingBetweenSlices
          metadata.SpacingBetweenSlices = parseFloat(raw);
          break;
        case '00281050': // WindowCenter
          {
            const arr = toNumberArray(raw);
            if (arr) metadata.WindowCenter = arr.length === 1 ? arr[0] : arr;
          }
          break;
        case '00281051': // WindowWidth
          {
            const arr = toNumberArray(raw);
            if (arr) metadata.WindowWidth = arr.length === 1 ? arr[0] : arr;
          }
          break;
        case '00281052': // RescaleIntercept
          metadata.RescaleIntercept = parseFloat(raw);
          break;
        case '00281053': // RescaleSlope
          metadata.RescaleSlope = parseFloat(raw);
          break;
        case '00280008': // NumberOfFrames
          metadata.NumberOfFrames = parseInt(raw, 10);
          break;
        case '00200052': // FrameOfReferenceUID
          metadata.FrameOfReferenceUID = raw;
          break;
        case '00281101': // RedPaletteColorLookupTableDescriptor
          metadata.RedPaletteColorLookupTableDescriptor = readWords(offset, valueLength);
          break;
        case '00281102': // GreenPaletteColorLookupTableDescriptor
          metadata.GreenPaletteColorLookupTableDescriptor = readWords(offset, valueLength);
          break;
        case '00281103': // BluePaletteColorLookupTableDescriptor
          metadata.BluePaletteColorLookupTableDescriptor = readWords(offset, valueLength);
          break;
        case '00281201': // RedPaletteColorLookupTableData
          metadata.RedPaletteColorLookupTableData = readWords(offset, valueLength);
          break;
        case '00281202': // GreenPaletteColorLookupTableData
          metadata.GreenPaletteColorLookupTableData = readWords(offset, valueLength);
          break;
        case '00281203': // BluePaletteColorLookupTableData
          metadata.BluePaletteColorLookupTableData = readWords(offset, valueLength);
          console.log('[MADO Prefetch] Extracted BluePaletteColorLookupTableData:', metadata.BluePaletteColorLookupTableData?.slice(0, 10), '...');
          break;
        case '00281221': // SegmentedRedPaletteColorLookupTableData
          metadata.SegmentedRedPaletteColorLookupTableData = readWords(offset, valueLength);
          console.log('[MADO Prefetch] Extracted SegmentedRedPaletteColorLookupTableData:', metadata.SegmentedRedPaletteColorLookupTableData?.slice(0, 10), '...');
          break;
        case '00281222': // SegmentedGreenPaletteColorLookupTableData
          metadata.SegmentedGreenPaletteColorLookupTableData = readWords(offset, valueLength);
          console.log('[MADO Prefetch] Extracted SegmentedGreenPaletteColorLookupTableData:', metadata.SegmentedGreenPaletteColorLookupTableData?.slice(0, 10), '...');
          break;
        case '00281223': // SegmentedBluePaletteColorLookupTableData
          metadata.SegmentedBluePaletteColorLookupTableData = readWords(offset, valueLength);
          console.log('[MADO Prefetch] Extracted SegmentedBluePaletteColorLookupTableData:', metadata.SegmentedBluePaletteColorLookupTableData?.slice(0, 10), '...');
          break;
        case '00281199': // PaletteColorLookupTableUID
          metadata.PaletteColorLookupTableUID = raw;
          console.log('[MADO Prefetch] Extracted PaletteColorLookupTableUID:', raw);
          break;
        default:
        // ignore
      }

      offset += valueLength;

      // NOTE: Previously there was an early exit here when Rows/Columns/PixelSpacing were found.
      // This was REMOVED because it prevented parsing palette color data (tags 0028,11xx and 0028,12xx)
      // which come AFTER the basic pixel module tags. We now parse the entire file to capture all metadata.
    }

    // Log if we found palette data
    if (metadata.RedPaletteColorLookupTableDescriptor) {
      console.log('[MADO Prefetch] ✅ Found palette color descriptors:', {
        red: metadata.RedPaletteColorLookupTableDescriptor,
        green: metadata.GreenPaletteColorLookupTableDescriptor,
        blue: metadata.BluePaletteColorLookupTableDescriptor,
        dataLengths: {
          red: metadata.RedPaletteColorLookupTableData?.length,
          green: metadata.GreenPaletteColorLookupTableData?.length,
          blue: metadata.BluePaletteColorLookupTableData?.length,
        },
        uid: metadata.PaletteColorLookupTableUID,
      });
    }
    // Log segmented palette data presence
    if (metadata.SegmentedRedPaletteColorLookupTableData) {
      console.log('[MADO Prefetch] ✅ Found segmented palette color data:', {
        redSegmentedLength: metadata.SegmentedRedPaletteColorLookupTableData?.length,
        greenSegmentedLength: metadata.SegmentedGreenPaletteColorLookupTableData?.length,
        blueSegmentedLength: metadata.SegmentedBluePaletteColorLookupTableData?.length,
      });
    }

    const keys = Object.keys(metadata);
    return keys.length ? (metadata as ExtractedSeriesMetadata) : null;
  } catch (err) {
    console.warn('[MADO Prefetch] Minimal implicit/explicit VR parser failed:', err);
    return null;
  }
}

/**
 * Fallback: map a naturalized dataset (from DicomMetaDictionary.naturalizeDataset)
 * to the ExtractedSeriesMetadata shape.
 */
function mapNaturalizedToMetadata(nat: any): ExtractedSeriesMetadata {
  const toNumberArray = (v: any) => {
    if (v === undefined || v === null) return undefined;
    if (Array.isArray(v)) return v.map((x: any) => (typeof x === 'number' ? x : parseFloat(String(x))));
    if (typeof v === 'string') {
      const parts = v.split('\\').map((p: string) => p.trim()).filter((p: string) => p !== '');
      const nums = parts.map((p: string) => { const n = parseFloat(p); return Number.isFinite(n) ? n : undefined; }).filter((x:any) => x !== undefined);
      return nums.length ? nums : undefined;
    }
    return undefined;
  };

  const metadata: ExtractedSeriesMetadata = {
    Rows: nat.Rows ?? nat.rows,
    Columns: nat.Columns ?? nat.columns,
    BitsAllocated: nat.BitsAllocated ?? nat.bitsAllocated,
    BitsStored: nat.BitsStored ?? nat.bitsStored,
    HighBit: nat.HighBit ?? nat.highBit,
    PixelRepresentation: nat.PixelRepresentation ?? nat.pixelRepresentation,
    SamplesPerPixel: nat.SamplesPerPixel ?? nat.samplesPerPixel,
    PhotometricInterpretation: nat.PhotometricInterpretation ?? nat.photometricInterpretation,
    PlanarConfiguration: nat.PlanarConfiguration ?? nat.planarConfiguration,

    PixelSpacing: toNumberArray(nat.PixelSpacing ?? nat.pixelSpacing),
    ImageOrientationPatient: toNumberArray(nat.ImageOrientationPatient ?? nat.imageOrientationPatient),
    ImagePositionPatient: toNumberArray(nat.ImagePositionPatient ?? nat.imagePositionPatient),
    SliceThickness: nat.SliceThickness ?? nat.sliceThickness,
    SpacingBetweenSlices: nat.SpacingBetweenSlices ?? nat.spacingBetweenSlices,

    RescaleIntercept: nat.RescaleIntercept ?? nat.rescaleIntercept,
    RescaleSlope: nat.RescaleSlope ?? nat.rescaleSlope,
    RescaleType: nat.RescaleType ?? nat.rescaleType,

    FrameOfReferenceUID: nat.FrameOfReferenceUID ?? nat.frameOfReferenceUID,
    NumberOfFrames: nat.NumberOfFrames ?? nat.numberOfFrames,
  };

  // Window center/width can be string or array
  const wc = toNumberArray(nat.WindowCenter ?? nat.windowCenter);
  const ww = toNumberArray(nat.WindowWidth ?? nat.windowWidth);
  if (wc) metadata.WindowCenter = wc.length === 1 ? wc[0] : wc;
  if (ww) metadata.WindowWidth = ww.length === 1 ? ww[0] : ww;

  return metadata;
}

/**
 * Robust fallback: scan a dict for common tags by key suffix, for nonstandard or weird dicts.
 */
function scanDictForCommonTags(dict: any): ExtractedSeriesMetadata | null {
  if (!dict || typeof dict !== 'object') return null;

  const getRawVal = (el: any) => {
    if (!el) return undefined;
    if (el.Value !== undefined && el.Value !== null) return el.Value;
    if (el.value !== undefined && el.value !== null) return el.value;
    // Some builds may use InlineBinary or other forms; ignore those
    return undefined;
  };

  const toNumberArrayFromRaw = (raw: any) => {
    if (!raw) return undefined;
    if (Array.isArray(raw)) {
      // raw may be array of numbers or strings
      const out = raw.map((v: any) => (typeof v === 'number' ? v : parseFloat(String(v)))).filter((n: any) => Number.isFinite(n));
      return out.length ? out : undefined;
    }
    if (typeof raw === 'string') {
      if (raw.includes('\\')) {
        const out = raw.split('\\').map((s: string) => parseFloat(s)).filter((n: number) => Number.isFinite(n));
        return out.length ? out : undefined;
      }
      const n = parseFloat(raw);
      return Number.isFinite(n) ? [n] : undefined;
    }
    return undefined;
  };

  const out: Partial<ExtractedSeriesMetadata> = {};

  const tagMap = {
    Rows: '00280010',
    Columns: '00280011',
    SamplesPerPixel: '00280002',
    PhotometricInterpretation: '00280004',
    PixelSpacing: '00280030',
    ImageOrientationPatient: '00200037',
    ImagePositionPatient: '00200032',
    SliceThickness: '00180050',
    SpacingBetweenSlices: '00180088',
  } as Record<string, string>;

  const keys = Object.keys(dict);
  for (const key of keys) {
    const upper = key.toUpperCase();
    for (const [field, tag] of Object.entries(tagMap)) {
      if (upper.endsWith(tag.toUpperCase())) {
        const raw = getRawVal(dict[key]);
        if (raw !== undefined) {
          if (field === 'PixelSpacing' || field === 'ImageOrientationPatient' || field === 'ImagePositionPatient') {
            const arr = toNumberArrayFromRaw(raw);
            if (arr) (out as any)[field] = arr;
          } else if (field === 'Rows' || field === 'Columns' || field === 'SamplesPerPixel') {
            const v = Array.isArray(raw) ? raw[0] : raw;
            const n = typeof v === 'number' ? v : parseInt(String(v), 10);
            if (Number.isFinite(n)) (out as any)[field] = n;
          } else if (field === 'SliceThickness' || field === 'SpacingBetweenSlices') {
            const v = Array.isArray(raw) ? raw[0] : raw;
            const n = parseFloat(String(v));
            if (Number.isFinite(n)) (out as any)[field] = n;
          } else if (field === 'PhotometricInterpretation') {
            const v = Array.isArray(raw) ? raw[0] : raw;
            (out as any)[field] = String(v);
          }
        }
      }
    }
  }

  const hasCore = out.Rows !== undefined || out.Columns !== undefined || out.PixelSpacing !== undefined;
  return hasCore ? (out as ExtractedSeriesMetadata) : null;
}

/**
 * Extracts DICOM metadata from either a DICOM P10 file or a raw dataset stream.
 *
 * Why this exists:
 * - WADO-RS multipart responses often contain the dataset bytes only (no P10 preamble/meta header).
 * - dcmjs `DicomMessage.readFile` expects a P10 file header and will throw "expected header is missing".
 *
 * Strategy:
 * 1) Try readFile (works for proper P10 files)
 * 2) Try reading as a raw dataset using `DicomMessage.read` with implicit VR little endian
 */
function tryMapDictOrNaturalize(dict: any): ExtractedSeriesMetadata | null {
  try {
    const mapped = mapDictToMetadata(dict);
    // If we have core fields, return mapped result
    if (mapped && (mapped.Rows !== undefined || mapped.Columns !== undefined || mapped.PixelSpacing !== undefined)) {
      return mapped;
    }

    // Try naturalizing the dataset to friendly keys if available
    if (DicomMetaDictionary && typeof DicomMetaDictionary.naturalizeDataset === 'function') {
      try {
        const naturalized = DicomMetaDictionary.naturalizeDataset(dict);
        if (naturalized) {
          const natMapped = mapNaturalizedToMetadata(naturalized);
          if (natMapped && (natMapped.Rows !== undefined || natMapped.Columns !== undefined || natMapped.PixelSpacing !== undefined)) {
            return natMapped;
          }
        }
      } catch (err) {
        console.warn('[MADO] naturalizeDataset failed:', err);
      }
    }

    // As a last-ditch effort, scan the dict keys for common tag endings
    const scanned = scanDictForCommonTags(dict);
    if (scanned) return scanned;
  } catch (err) {
    console.warn('[MADO] tryMapDictOrNaturalize error:', err);
  }

  return null;
}

export function extractMetadataFromDicomBuffer(arrayBuffer: ArrayBuffer): ExtractedSeriesMetadata {
  // Prefer DicomDict.parseDicomDataSet when available (works in browser and node builds)
  if (DicomDict && typeof DicomDict.parseDicomDataSet === 'function') {
    try {
      const dicomDict = DicomDict.parseDicomDataSet(arrayBuffer);
      if (dicomDict?.dict) {
        console.log('[MADO] Parsed dataset using DicomDict.parseDicomDataSet');
        const r = tryMapDictOrNaturalize(dicomDict.dict);
        if (r) return r;
      }
    } catch (err) {
      console.warn('[MADO] DicomDict.parseDicomDataSet failed:', err);
      // fallthrough to other methods
    }
  }

  // Check for Part 10 by looking for 'DICM' at offset 128
  try {
    const view = new Uint8Array(arrayBuffer);
    const isPart10 = view.length > 132 && view[128] === 0x44 && view[129] === 0x49 && view[130] === 0x43 && view[131] === 0x4d;
    if (isPart10 && DicomMessage && typeof DicomMessage.readFile === 'function') {
      try {
        console.log('[MADO] Detected Part 10 file; using DicomMessage.readFile');
        const dicomData = DicomMessage.readFile(arrayBuffer, { untilTag: '7FE00010' });
        if (dicomData?.dict) {
          const r = tryMapDictOrNaturalize(dicomData.dict);
          if (r) return r;
        }
      } catch (err) {
        console.warn('[MADO] DicomMessage.readFile failed on Part10:', err);
      }
    }
  } catch (err) {
    console.warn('[MADO] Error checking Part10 header:', err);
  }

  // Try wrapping the raw dataset in a minimal P10 header (implicit VR) and parse with readFile
  if (DicomMessage && typeof DicomMessage.readFile === 'function') {
    try {
      const wrappedImplicit = wrapDatasetInP10(arrayBuffer, '1.2.840.10008.1.2');
      const dicomData = DicomMessage.readFile(wrappedImplicit, { untilTag: '7FE00010' });
      if (dicomData?.dict) {
        console.log('[MADO] Parsed by wrapping dataset in P10 (implicit VR)');
        const r = tryMapDictOrNaturalize(dicomData.dict);
        if (r) return r;
      }
    } catch (err) {
      console.warn('[MADO] Wrapped implicit P10 parse failed:', err);
    }

    try {
      const wrappedExplicit = wrapDatasetInP10(arrayBuffer, '1.2.840.10008.1.2.1');
      const dicomData2 = DicomMessage.readFile(wrappedExplicit, { untilTag: '7FE00010' });
      if (dicomData2?.dict) {
        console.log('[MADO] Parsed by wrapping dataset in P10 (explicit VR)');
        const r2 = tryMapDictOrNaturalize(dicomData2.dict);
        if (r2) return r2;
      }
    } catch (err) {
      console.warn('[MADO] Wrapped explicit P10 parse failed:', err);
    }
  }

  // Final fallback: try the lightweight implicit VR scanner
  const minimal = parseImplicitVrLittleEndianForCommonTags(arrayBuffer);
  if (minimal) {
    console.log('[MADO] Parsed using minimal implicit VR scanner fallback');
    return minimal;
  }

  throw new Error('Could not parse DICOM buffer');
}

/**
 * Builds the WADO-RS URL for fetching a single instance.
 */
function buildWadoRsUrl(
  wadoRoot: string,
  studyInstanceUID: string,
  seriesInstanceUID: string,
  sopInstanceUID: string
): string {
  // Remove trailing slash if present
  const baseUrl = wadoRoot.replace(/\/$/, '');
  return `${baseUrl}/studies/${studyInstanceUID}/series/${seriesInstanceUID}/instances/${sopInstanceUID}`;
}

/**
 * Fetches the first image of a series and extracts metadata from it.
 * The fetched ArrayBuffer is cached for later reuse.
 */
async function fetchAndExtractSeriesMetadata(
  displaySet: MadoDisplaySet,
  wadoRoot: string,
  headers: HeadersInit = {}
): Promise<ExtractedSeriesMetadata | null> {
  const { studyInstanceUID, seriesInstanceUID, instances } = displaySet;

  if (!instances || instances.length === 0) {
    console.warn(`[MADO Prefetch] No instances in series ${seriesInstanceUID}`);
    return null;
  }

  // Get the first instance (already sorted by instance number)
  const firstInstance = instances[0];
  const { sopInstanceUID } = firstInstance;

  // Use the wadoRoot from the instance if available, otherwise use the provided one
  const effectiveWadoRoot = firstInstance.wadoRoot || displaySet.retrieveURL?.split('/studies')[0] || wadoRoot;

  if (!effectiveWadoRoot) {
    console.error(`[MADO Prefetch] No WADO root available for series ${seriesInstanceUID}`);
    return null;
  }

  const url = buildWadoRsUrl(effectiveWadoRoot, studyInstanceUID, seriesInstanceUID, sopInstanceUID);

  console.log(`🔍 [MADO Prefetch] Fetching first image for series ${seriesInstanceUID.substring(0, 20)}...`);
  console.log(`   URL: ${url}`);

  try {
    // Try fetching as WADO-RS multipart octet-stream first (preferred for many WADO-RS servers)
    let response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        Accept: 'multipart/related; type=application/dicom; transfer-syntax=*',
      },
    });

    if (!response.ok) {
      // Fallback sequence: some servers expect multipart with application/dicom type
      console.log(`[MADO Prefetch] Primary multipart octet-stream request failed (${response.status}), trying multipart application/dicom...`);
      response = await fetch(url, {
        method: 'GET',
        headers: {
          ...headers,
          Accept: 'multipart/related; type="application/dicom"',
        },
      });
    }

    if (!response.ok) {
      // Last-resort fallback to application/dicom (some servers accept direct DICOM)
      console.log(`[MADO Prefetch] Multipart application/dicom request failed (${response.status}), trying application/dicom...`);
      response = await fetch(url, {
        method: 'GET',
        headers: {
          ...headers,
          Accept: 'application/dicom',
        },
      });
    }

    if (!response.ok) {
      console.error(`[MADO Prefetch] Failed to fetch image: ${response.status} ${response.statusText}`);
      return null;
    }

    // Read the response once into an ArrayBuffer. Use a single variable name.
    let fetchedArrayBuffer = await response.arrayBuffer();

    // Check if this is a multipart response by looking at content-type
    const contentType = response.headers.get('content-type') || '';
    console.log(`[MADO Prefetch] Response Content-Type: ${contentType}`);

    // Removed redundant reassignment of fetchedArrayBuffer
    if (contentType.includes('multipart')) {
      console.log('[MADO Prefetch] Detected multipart response, extracting first part...');
      const extractedBuffer = extractFirstPartFromMultipart(fetchedArrayBuffer, contentType);
      if (extractedBuffer) {
        console.log(`[MADO Prefetch] Using buffer (${(extractedBuffer.byteLength / 1024).toFixed(1)} KB)`);
        fetchedArrayBuffer = extractedBuffer;
      } else {
        console.warn('[MADO Prefetch] Failed to extract multipart first part, using full buffer');
      }
    }

    // Now attempt to parse the (possibly extracted) buffer as DICOM and extract metadata.
    // Try parsing with the buffer as-is, and if that fails, try adding P10 preamble.
    let extractedMetadata: ExtractedSeriesMetadata;
    try {
      extractedMetadata = extractMetadataFromDicomBuffer(fetchedArrayBuffer);
      console.log('[MADO Prefetch] Successfully parsed DICOM buffer');
    } catch (parseError) {
      console.warn('[MADO Prefetch] dcmjs failed to parse buffer as DICOM:', parseError);
      // Fallback: try a minimal implicit-vr parser for the tags we care about
      extractedMetadata = parseImplicitVrLittleEndianForCommonTags(fetchedArrayBuffer);
      if (extractedMetadata) {
        console.log('[MADO Prefetch] Parsed metadata using minimal implicit-VR parser fallback');
      } else {
        console.warn('[MADO Prefetch] Could not extract DICOM metadata from fetched response; skipping metadata extraction');
        return null;
      }
    }

    // Cache the fetched image for later reuse
    prefetchedImageCache.set(
      `wadors:${effectiveWadoRoot}/studies/${studyInstanceUID}/series/${seriesInstanceUID}/instances/${sopInstanceUID}/frames/1`,
      fetchedArrayBuffer
    );

    prefetchedImageCache.set(
      `wadors:${effectiveWadoRoot}/studies/${studyInstanceUID}/series/${seriesInstanceUID}/instances/${sopInstanceUID}`,
      fetchedArrayBuffer
    );

    console.log(`✅ [MADO Prefetch] Cached image (${(fetchedArrayBuffer.byteLength / 1024).toFixed(1)} KB)`);

    console.log(`📋 [MADO Prefetch] Extracted metadata:`, {
      Rows: extractedMetadata.Rows,
      Columns: extractedMetadata.Columns,
      SamplesPerPixel: extractedMetadata.SamplesPerPixel,
      PhotometricInterpretation: extractedMetadata.PhotometricInterpretation,
      PixelSpacing: extractedMetadata.PixelSpacing,
      WindowCenter: extractedMetadata.WindowCenter,
      WindowWidth: extractedMetadata.WindowWidth,
    });

    return extractedMetadata;
  } catch (error) {
    console.error(`[MADO Prefetch] Error fetching/parsing image:`, error);
    return null;
  }
}

/**
 * Apply extracted metadata from the first image to all instances in the series.
 * This uses deduction to compute instance-specific values (e.g., ImagePositionPatient).
 */
export function applyExtractedMetadataToSeries(
  instances: MadoInstance[],
  extractedMeta: ExtractedSeriesMetadata
): void {
  if (!extractedMeta || instances.length === 0) {
    return;
  }

  // Calculate slice spacing for position interpolation
  const sliceSpacing = extractedMeta.SpacingBetweenSlices || extractedMeta.SliceThickness || 1.0;

  // Get orientation vectors for position calculation
  const orientation = extractedMeta.ImageOrientationPatient || [1, 0, 0, 0, 1, 0];
  const firstPosition = extractedMeta.ImagePositionPatient || [0, 0, 0];

  // Calculate the slice normal (cross product of row and column vectors)
  const rowCos = orientation.slice(0, 3);
  const colCos = orientation.slice(3, 6);
  const sliceNormal = [
    rowCos[1] * colCos[2] - rowCos[2] * colCos[1],
    rowCos[2] * colCos[0] - rowCos[0] * colCos[2],
    rowCos[0] * colCos[1] - rowCos[1] * colCos[0],
  ];

  instances.forEach((instance: any, index: number) => {
    // Apply common metadata to all instances
    if (extractedMeta.Rows !== undefined) instance.rows = extractedMeta.Rows;
    if (extractedMeta.Columns !== undefined) instance.columns = extractedMeta.Columns;
    if (extractedMeta.BitsAllocated !== undefined) instance.BitsAllocated = extractedMeta.BitsAllocated;
    if (extractedMeta.BitsStored !== undefined) instance.BitsStored = extractedMeta.BitsStored;
    if (extractedMeta.HighBit !== undefined) instance.HighBit = extractedMeta.HighBit;
    if (extractedMeta.PixelRepresentation !== undefined) instance.PixelRepresentation = extractedMeta.PixelRepresentation;
    if (extractedMeta.SamplesPerPixel !== undefined) instance.SamplesPerPixel = extractedMeta.SamplesPerPixel;
    if (extractedMeta.PhotometricInterpretation !== undefined) instance.PhotometricInterpretation = extractedMeta.PhotometricInterpretation;
    if (extractedMeta.PlanarConfiguration !== undefined) instance.PlanarConfiguration = extractedMeta.PlanarConfiguration;
    if (extractedMeta.PixelSpacing !== undefined) instance.pixelSpacing = extractedMeta.PixelSpacing;
    if (extractedMeta.SliceThickness !== undefined) instance.sliceThickness = extractedMeta.SliceThickness;
    if (extractedMeta.ImageOrientationPatient !== undefined) instance.imageOrientationPatient = extractedMeta.ImageOrientationPatient;
    if (extractedMeta.WindowCenter !== undefined) instance.WindowCenter = extractedMeta.WindowCenter;
    if (extractedMeta.WindowWidth !== undefined) instance.WindowWidth = extractedMeta.WindowWidth;
    if (extractedMeta.RescaleIntercept !== undefined) instance.RescaleIntercept = extractedMeta.RescaleIntercept;
    if (extractedMeta.RescaleSlope !== undefined) instance.RescaleSlope = extractedMeta.RescaleSlope;
    if (extractedMeta.RescaleType !== undefined) instance.RescaleType = extractedMeta.RescaleType;
    if (extractedMeta.FrameOfReferenceUID !== undefined) instance.FrameOfReferenceUID = extractedMeta.FrameOfReferenceUID;
    if (extractedMeta.TransferSyntaxUID !== undefined) instance.TransferSyntaxUID = extractedMeta.TransferSyntaxUID;

    // Palette Color Lookup Table
    if (extractedMeta.RedPaletteColorLookupTableDescriptor !== undefined) instance.RedPaletteColorLookupTableDescriptor = extractedMeta.RedPaletteColorLookupTableDescriptor;
    if (extractedMeta.GreenPaletteColorLookupTableDescriptor !== undefined) instance.GreenPaletteColorLookupTableDescriptor = extractedMeta.GreenPaletteColorLookupTableDescriptor;
    if (extractedMeta.BluePaletteColorLookupTableDescriptor !== undefined) instance.BluePaletteColorLookupTableDescriptor = extractedMeta.BluePaletteColorLookupTableDescriptor;
    if (extractedMeta.RedPaletteColorLookupTableData !== undefined) instance.RedPaletteColorLookupTableData = extractedMeta.RedPaletteColorLookupTableData;
    if (extractedMeta.GreenPaletteColorLookupTableData !== undefined) instance.GreenPaletteColorLookupTableData = extractedMeta.GreenPaletteColorLookupTableData;
    if (extractedMeta.BluePaletteColorLookupTableData !== undefined) instance.BluePaletteColorLookupTableData = extractedMeta.BluePaletteColorLookupTableData;
    if (extractedMeta.PaletteColorLookupTableUID !== undefined) instance.PaletteColorLookupTableUID = extractedMeta.PaletteColorLookupTableUID;

    // Calculate ImagePositionPatient for each slice based on index
    // Assumes slices are ordered and equally spaced along the slice normal
    if (extractedMeta.ImagePositionPatient) {
      const offset = index * sliceSpacing;
      instance.imagePositionPatient = [
        firstPosition[0] + sliceNormal[0] * offset,
        firstPosition[1] + sliceNormal[1] * offset,
        firstPosition[2] + sliceNormal[2] * offset,
      ];
    }

    // Mark as having prefetched metadata
    instance._prefetchedMetadata = true;
  });

  console.log(`✅ [MADO Prefetch] Applied extracted metadata to ${instances.length} instances`);
}

/**
 * Prefetch the first image of each series and extract metadata.
 * This should be called before synthesizeMetadataFromMado.
 *
 * @param displaySets - Array of MADO display sets
 * @param wadoRoot - Default WADO root URL
 * @param headers - Authorization headers
 * @returns Map of seriesInstanceUID to extracted metadata
 */
export async function prefetchSeriesFirstImages(
  displaySets: MadoDisplaySet[],
  wadoRoot: string,
  headers: HeadersInit = {}
): Promise<Map<string, ExtractedSeriesMetadata>> {
  console.log(`🚀 [MADO Prefetch] Starting prefetch for ${displaySets.length} series...`);

  const metadataMap = new Map<string, ExtractedSeriesMetadata>();

  // Process series in parallel for speed, but with a concurrency limit
  const CONCURRENCY_LIMIT = 4;
  const chunks: MadoDisplaySet[][] = [];

  for (let i = 0; i < displaySets.length; i += CONCURRENCY_LIMIT) {
    chunks.push(displaySets.slice(i, i + CONCURRENCY_LIMIT));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(async (displaySet) => {
      try {
        const metadata = await fetchAndExtractSeriesMetadata(displaySet, wadoRoot, headers);
        if (metadata) {
          metadataMap.set(displaySet.seriesInstanceUID, metadata);
        }
      } catch (error) {
        console.error(`[MADO Prefetch] Error prefetching series ${displaySet.seriesInstanceUID}:`, error);
      }
    });

    // Wait for the chunk to complete
    await Promise.all(promises);
  }

  console.log(`✅ [MADO Prefetch] Completed prefetch for ${metadataMap.size} series`);
  return metadataMap;
}

/**
 * Wrap a raw dataset ArrayBuffer into a minimal DICOM Part 10 file so that
 * parsers that expect a P10 preamble + file meta header can read it.
 * This constructs a File Meta Information header (group 0002) with Transfer Syntax UID
 * and prepends the 128-byte preamble and 'DICM' marker.
 */
function wrapDatasetInP10(datasetBuffer: ArrayBuffer, transferSyntaxUID = '1.2.840.10008.1.2') {
  const encoder = new TextEncoder();
  const preamble = new Uint8Array(128 + 4); // 128 bytes preamble + 'DICM'
  // preamble already zeroed
  const dicm = encoder.encode('DICM');
  preamble.set(dicm, 128);

  // Build Transfer Syntax UID element (0002,0010) VR=UI
  // Tag (4 bytes) + VR (2 bytes) + length (2 bytes) + value
  const tsValueBytesUnpadded = encoder.encode(transferSyntaxUID);
  // UI values should be padded to even length with a NULL (0x00)
  const tsPad = (tsValueBytesUnpadded.length % 2 === 0) ? 0 : 1;
  const tsValueLength = tsValueBytesUnpadded.length + tsPad;
  const tsElementSize = 4 + 2 + 2 + tsValueLength; // tag + VR + len(2) + value

  // Build the UI element bytes
  const tsElement = new Uint8Array(tsElementSize);
  const dvTs = new DataView(tsElement.buffer);
  let off = 0;
  // Tag (0002,0010)
  dvTs.setUint16(off, 0x0002, true); off += 2;
  dvTs.setUint16(off, 0x0010, true); off += 2;
  // VR 'UI'
  tsElement[off++] = 'U'.charCodeAt(0);
  tsElement[off++] = 'I'.charCodeAt(0);
  // 2-byte length
  dvTs.setUint16(off, tsValueLength, true); off += 2;
  // value bytes
  tsElement.set(tsValueBytesUnpadded, off);
  off += tsValueBytesUnpadded.length;
  if (tsPad) {
    tsElement[off++] = 0x00;
  }

  // Now the Group Length element (0002,0000) VR=UL length=4 value = length of following meta elements
  const groupLengthValue = tsElement.length;
  const glElement = new Uint8Array(4 + 2 + 2 + 4); // tag + VR + len(2) + 4-byte UL value
  const dvGl = new DataView(glElement.buffer);
  off = 0;
  dvGl.setUint16(off, 0x0002, true); off += 2;
  dvGl.setUint16(off, 0x0000, true); off += 2;
  // VR 'UL'
  glElement[off++] = 'U'.charCodeAt(0);
  glElement[off++] = 'L'.charCodeAt(0);
  // 2-byte length (4)
  dvGl.setUint16(off, 4, true); off += 2;
  // 4-byte value (group length)
  dvGl.setUint32(off, groupLengthValue, true); off += 4;

  // Concatenate preamble + groupLength + tsElement + dataset
  const totalLength = preamble.length + glElement.length + tsElement.length + datasetBuffer.byteLength;
  const out = new Uint8Array(totalLength);
  let pos = 0;
  out.set(preamble, pos); pos += preamble.length;
  out.set(glElement, pos); pos += glElement.length;
  out.set(tsElement, pos); pos += tsElement.length;
  out.set(new Uint8Array(datasetBuffer), pos);

  return out.buffer;
}

/**
 * Debug helper: log sample keys and element value shapes in a dcmjs dictionary.
 */
function debugLogDict(dict: any, label = '') {
  try {
    if (!dict || typeof dict !== 'object') {
      console.warn('[MADO debug] debugLogDict: dict is not an object', label);
      return;
    }
    const keys = Object.keys(dict);
    console.warn(`[MADO debug] ${label} dict has ${keys.length} keys, sample keys:`, keys.slice(0, 50));
    keys.slice(0, 50).forEach((k) => {
      try {
        const el = dict[k];
        if (!el) return;
        const val = el.Value !== undefined ? el.Value : el.value !== undefined ? el.value : el;
        let info: any = { type: typeof val };
        if (Array.isArray(val)) {
          info.kind = 'array';
          info.length = val.length;
          info.sample = val.slice ? val.slice(0, 3) : val;
        } else if (val && val.constructor && val.constructor.name) {
          info.constructor = val.constructor.name;
          if (val instanceof Uint8Array) info.length = val.length;
        } else {
          info.sample = val;
        }
        console.warn(`[MADO debug] ${label} key=${k} =>`, info);
      } catch (e) {
        /* ignore */
      }
    });
  } catch (e) {
    console.warn('[MADO debug] debugLogDict failed:', e);
  }
}

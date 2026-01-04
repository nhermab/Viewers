import type { MadoDisplaySet, MadoInstance } from './MadoParser';

/**
 * DICOM Metadata Synthesis Engine
 * Consolidates MADO data into high-fidelity DICOM JSON structures.
 */

// --- 1. THE COMPLETE SOP CLASS DICTIONARY ---

export const SOP_CLASSES = {
  // Common / System
  VERIFICATION: '1.2.840.10008.1.1',
  MEDIA_STORAGE_DIRECTORY: '1.2.840.10008.1.3.10',

  // Radiology: Cross-Sectional (3D)
  CT: '1.2.840.10008.5.1.4.1.1.2',
  ENHANCED_CT: '1.2.840.10008.5.1.4.1.1.2.1',
  MR: '1.2.840.10008.5.1.4.1.1.4',
  ENHANCED_MR: '1.2.840.10008.5.1.4.1.1.4.1',
  MR_SPECTROSCOPY: '1.2.840.10008.5.1.4.1.1.4.2',
  PET: '1.2.840.10008.5.1.4.1.1.128',
  NM: '1.2.840.10008.5.1.4.1.1.20',
  NM_RETIRED: '1.2.840.10008.5.1.4.1.1.5',

  // Radiology: Projection & X-Ray (2D)
  CR: '1.2.840.10008.5.1.4.1.1.1',
  DX_PRESENTATION: '1.2.840.10008.5.1.4.1.1.1.1',
  DX_PROCESSING: '1.2.840.10008.5.1.4.1.1.1.1.1',
  MG_PRESENTATION: '1.2.840.10008.5.1.4.1.1.1.2',
  MG_PROCESSING: '1.2.840.10008.5.1.4.1.1.1.2.1',
  IO_PRESENTATION: '1.2.840.10008.5.1.4.1.1.1.3',
  IO_PROCESSING: '1.2.840.10008.5.1.4.1.1.1.3.1',
  XA: '1.2.840.10008.5.1.4.1.1.12.1',
  ENHANCED_XA: '1.2.840.10008.5.1.4.1.1.12.1.1',
  XRF: '1.2.840.10008.5.1.4.1.1.12.2',
  ENHANCED_XRF: '1.2.840.10008.5.1.4.1.1.12.2.1',

  // Ultrasound
  US: '1.2.840.10008.5.1.4.1.1.6.1',
  US_MULTIFRAME: '1.2.840.10008.5.1.4.1.1.3.1',
  US_RETIRED: '1.2.840.10008.5.1.4.1.1.6',

  // Radiotherapy (RT)
  RT_IMAGE: '1.2.840.10008.5.1.4.1.1.481.1',
  RT_DOSE: '1.2.840.10008.5.1.4.1.1.481.2',
  RT_STRUCT: '1.2.840.10008.5.1.4.1.1.481.3',
  RT_PLAN: '1.2.840.10008.5.1.4.1.1.481.5',
  RT_ION_PLAN: '1.2.840.10008.5.1.4.1.1.481.8',

  // Visible Light & Specialized
  VL_ENDOSCOPIC: '1.2.840.10008.5.1.4.1.1.77.1.1',
  VIDEO_ENDOSCOPIC: '1.2.840.10008.5.1.4.1.1.77.1.1.1',
  VL_MICROSCOPIC: '1.2.840.10008.5.1.4.1.1.77.1.2',
  VL_PHOTOGRAPHIC: '1.2.840.10008.5.1.4.1.1.77.1.4',
  VL_WHOLE_SLIDE: '1.2.840.10008.5.1.4.1.1.77.1.6',
  OP_PHOTO_8BIT: '1.2.840.10008.5.1.4.1.1.77.1.5.1',
  OP_PHOTO_16BIT: '1.2.840.10008.5.1.4.1.1.77.1.5.2',

  // Secondary Capture & Documents
  SECONDARY_CAPTURE: '1.2.840.10008.5.1.4.1.1.7',
  SC_MULTIFRAME_TRUE_COLOR: '1.2.840.10008.5.1.4.1.1.7.4',
  ENCAPSULATED_PDF: '1.2.840.10008.5.1.4.1.1.104.1',
  RAW_DATA: '1.2.840.10008.5.1.4.1.1.66',

  // Structured Reports (SR)
  BASIC_TEXT_SR: '1.2.840.10008.5.1.4.1.1.88.11',
  ENHANCED_SR: '1.2.840.10008.5.1.4.1.1.88.22',
  COMPREHENSIVE_SR: '1.2.840.10008.5.1.4.1.1.88.33',
  KEY_OBJECT_SELECTION: '1.2.840.10008.5.1.4.1.1.88.59',

  // Waveforms
  ECG_12_LEAD: '1.2.840.10008.5.1.4.1.1.9.1.1',
  ECG_GENERAL: '1.2.840.10008.5.1.4.1.1.9.1.2',
  HEMODYNAMIC_WAVEFORM: '1.2.840.10008.5.1.4.1.1.9.2.1',
} as const;

// --- 2. THE DEFAULT PHYSICS REGISTRY ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SOP_PHYSICS_DEFAULTS: Record<string, any> = {
  [SOP_CLASSES.CT]: {
    Modality: 'CT',
    PixelRepresentation: 1, // Signed for Hounsfield Units
    RescaleIntercept: -1024,
    RescaleSlope: 1,
    WindowCenter: 40,
    WindowWidth: 400,
  },
  [SOP_CLASSES.MR]: {
    Modality: 'MR',
    WindowCenter: 600,
    WindowWidth: 1200,
  },
  [SOP_CLASSES.PET]: {
    Modality: 'PT',
    Rows: 128,
    Columns: 128,
    RescaleType: 'BQML',
    WindowCenter: 20,
    WindowWidth: 40,
  },
  [SOP_CLASSES.DX_PRESENTATION]: {
    Modality: 'DX',
    BitsStored: 12,
    HighBit: 11,
    PixelSpacing: [0.15, 0.15],
    PresentationIntentType: 'FOR PRESENTATION',
  },
  [SOP_CLASSES.VL_ENDOSCOPIC]: {
    Modality: 'ES',
    SamplesPerPixel: 3,
    PhotometricInterpretation: 'RGB',
    BitsAllocated: 8,
    BitsStored: 8,
    HighBit: 7,
  },
  [SOP_CLASSES.RT_IMAGE]: {
    Modality: 'RTIMG',
    WindowCenter: 2048,
    WindowWidth: 4096,
  },
  [SOP_CLASSES.ENCAPSULATED_PDF]: {
    Modality: 'DOC',
    _isDocument: true,
  },
  [SOP_CLASSES.SECONDARY_CAPTURE]: {
    Modality: 'OT',
    BitsAllocated: 8,
    BitsStored: 8,
    HighBit: 7,
    PixelRepresentation: 0,
    // Don't set SamplesPerPixel or PhotometricInterpretation
    // to allow inference from actual DICOM values
  },
};

// Map Enhanced / Retired aliases
SOP_PHYSICS_DEFAULTS[SOP_CLASSES.ENHANCED_CT] = SOP_PHYSICS_DEFAULTS[SOP_CLASSES.CT];
SOP_PHYSICS_DEFAULTS[SOP_CLASSES.ENHANCED_MR] = SOP_PHYSICS_DEFAULTS[SOP_CLASSES.MR];
SOP_PHYSICS_DEFAULTS[SOP_CLASSES.NM] = SOP_PHYSICS_DEFAULTS[SOP_CLASSES.PET];
SOP_PHYSICS_DEFAULTS[SOP_CLASSES.VIDEO_ENDOSCOPIC] =
  SOP_PHYSICS_DEFAULTS[SOP_CLASSES.VL_ENDOSCOPIC];
SOP_PHYSICS_DEFAULTS[SOP_CLASSES.SC_MULTIFRAME_TRUE_COLOR] =
  SOP_PHYSICS_DEFAULTS[SOP_CLASSES.VL_ENDOSCOPIC];

// --- 2b. MODALITY PHYSICS REGISTRY ---
// These defaults are keyed by Modality (not SOPClass) and intended to supply
// clinically sane pixel/VOI/LUT defaults when SOPClass isn't sufficient.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODALITY_PHYSICS: Record<string, any> = {
  CT: {
    PixelRepresentation: 1,
    RescaleIntercept: -1024,
    RescaleSlope: 1,
    WindowCenter: 40,
    WindowWidth: 400,
  },
  MR: { WindowCenter: 600, WindowWidth: 1200 },
  PT: {
    RescaleType: 'BQML',
    Rows: 128,
    Columns: 128,
    WindowCenter: 20,
    WindowWidth: 40,
  },
  US: {
    SamplesPerPixel: 3,
    PhotometricInterpretation: 'YBR_FULL_422',
    BitsAllocated: 8,
    BitsStored: 8,
    HighBit: 7,
  },
  XA: { BitsAllocated: 8, BitsStored: 8, HighBit: 7 },
  // Slide microscopy / whole slide imaging
  SM: {
    SamplesPerPixel: 3,
    PhotometricInterpretation: 'YBR_FULL',
    PlanarConfiguration: 0,
  },
  // OT (Other) - often used for color secondary capture, ultrasound, etc.
  OT: {
    BitsAllocated: 8,
    BitsStored: 8,
    HighBit: 7,
    PixelRepresentation: 0,
    // Don't set SamplesPerPixel or PhotometricInterpretation here
    // as OT can be grayscale or color - let inference handle it
  },
};

/**
 * Ensures spacing is an array of two valid numbers.
 */
function validateSpacing(spacing: any): [number, number] {
  if (Array.isArray(spacing) && spacing.length >= 2) {
    const r = parseFloat(spacing[0]);
    const c = parseFloat(spacing[1]);
    if (!isNaN(r) && r > 0 && !isNaN(c) && c > 0) {
      return [r, c];
    }
  }
  return [1.0, 1.0];
}

/**
 * Fixes technical DICOM conflicts that cause viewer crashes.
 */
function patchTechnicalAttributes(metadata: any, instance: any) {
  // Ensure consistency between SamplesPerPixel and Interpretation
  if (metadata.SamplesPerPixel === 3 && typeof metadata.PhotometricInterpretation === 'string') {
    if (metadata.PhotometricInterpretation.startsWith('MONO')) {
      metadata.PhotometricInterpretation = 'RGB';
    }
  }

  // Multi-frame support
  const numberOfFrames = Number(instance?.numberOfFrames || instance?.NumberOfFrames || 0);
  if (!isNaN(numberOfFrames) && numberOfFrames > 1) {
    metadata.NumberOfFrames = numberOfFrames;
    // Keep defaults minimal; downstream loaders may override with true cine timing.
    metadata.FrameIncrementPointer = '(0018,1063)';
    metadata.FrameTime = metadata.FrameTime ?? 33.33;
  }
}

/**
 * Creates series-level summary metadata.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function synthesizeSeriesMetadata(displaySet: MadoDisplaySet): any {
  // Try to get SliceThickness from first instance if available
  const firstInstance = displaySet.instances?.[0] as any;
  const sliceThickness = firstInstance?.SliceThickness || firstInstance?.sliceThickness;

  return {
    StudyInstanceUID: displaySet.studyInstanceUID,
    SeriesInstanceUID: displaySet.seriesInstanceUID,
    SeriesDescription: displaySet.seriesDescription || '',
    SeriesNumber: displaySet.seriesNumber ? parseInt(displaySet.seriesNumber) : 1,
    SeriesDate: displaySet.seriesDate || '',
    SeriesTime: displaySet.seriesTime || '',
    Modality: displaySet.modality || 'OT',
    NumberOfSeriesRelatedInstances:
      displaySet.numberOfSeriesRelatedInstances || displaySet.instances?.length || 1,

    // SliceThickness from first instance (important for 3D reconstruction)
    SliceThickness: sliceThickness,

    // Patient Module
    PatientName: displaySet.patientName || 'Anonymous',
    PatientID: displaySet.patientID || 'UNKNOWN',
    PatientBirthDate: displaySet.patientBirthDate || '',
    PatientSex: displaySet.patientSex || 'O',

    // Patient Study Module (if available from displaySet or first instance)
    PatientAge: (displaySet as any).patientAge || firstInstance?.PatientAge,
    PatientSize: (displaySet as any).patientSize || firstInstance?.PatientSize,
    PatientWeight: (displaySet as any).patientWeight || firstInstance?.PatientWeight,

    // Study Module
    StudyDescription: displaySet.studyDescription || '',
    StudyDate: displaySet.studyDate || '',
    StudyTime: displaySet.studyTime || '',
    AccessionNumber: displaySet.accessionNumber || '',
    StudyID: (displaySet as any).studyID || '',

    _isSynthesized: true,
  };
}

/**
 * Creates instance-level metadata with physical defaults based on SOP Class.
 *
 * Priority for metadata values:
 * 1. Prefetched metadata from actual DICOM file (highest priority)
 * 2. Explicit values from MADO manifest instance
 * 3. Modality-based defaults
 * 4. Generic defaults
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function synthesizeInstanceMetadata(
  displaySet: MadoDisplaySet,
  instance: MadoInstance,
  context: { wadoRoot: string; wadoUri: string; imageId: string; index: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const sopClass = (instance as any).sopClassUID || SOP_CLASSES.SECONDARY_CAPTURE;
  const modality = String((displaySet as any).modality || 'OT').toUpperCase();

  const modalityPhysics = MODALITY_PHYSICS[modality] || {};

  // Check if instance has prefetched metadata (from first image extraction)
  const hasPrefetchedMetadata = (instance as any)._prefetchedMetadata === true;

  // Prefer prefetched values, then instance values, then defaults
  const pixelSpacing = validateSpacing(
    (instance as any).pixelSpacing || (instance as any).imagerPixelSpacing || [1.0, 1.0]
  );

  const orientation =
    (instance as any).imageOrientationPatient || (instance as any).ImageOrientationPatient || [1, 0, 0, 0, 1, 0];

  const sliceThickness = (instance as any).sliceThickness || (instance as any).SliceThickness || 1.0;

  // --- PIXEL MODULE WITH PREFETCH PRIORITY ---
  // Priority: prefetched > instance explicit > modality defaults > generic defaults
  let samplesPerPixel = (instance as any).SamplesPerPixel || modalityPhysics.SamplesPerPixel;
  let photometricInterpretation = (instance as any).PhotometricInterpretation || modalityPhysics.PhotometricInterpretation || 'MONOCHROME2';
  let bitsAllocated = (instance as any).BitsAllocated || modalityPhysics.BitsAllocated;
  let bitsStored = (instance as any).BitsStored || modalityPhysics.BitsStored;
  let highBit = (instance as any).HighBit || modalityPhysics.HighBit;
  let pixelRepresentation = (instance as any).PixelRepresentation ?? modalityPhysics.PixelRepresentation ?? 0;

  // Infer SamplesPerPixel from PhotometricInterpretation if not explicitly set
  const piStr = String(photometricInterpretation).toUpperCase();
  const isColorImage = piStr.startsWith('RGB') || piStr.startsWith('YBR');

  if (samplesPerPixel === undefined) {
    if (isColorImage) {
      samplesPerPixel = 3;
      console.log('[MADO Synthesis] Inferred SamplesPerPixel=3 from PhotometricInterpretation:', photometricInterpretation);
    } else if (piStr === 'PALETTE COLOR') {
      samplesPerPixel = 1;
    } else {
      samplesPerPixel = 1; // Default for MONOCHROME
    }
  }

  // Infer bit depth from PhotometricInterpretation if not set
  // Color images (RGB/YBR) are typically 8-bit per component
  if (bitsAllocated === undefined && isColorImage) {
    bitsAllocated = 8;
    console.log('[MADO Synthesis] Inferred BitsAllocated=8 for color image');
  }
  if (bitsStored === undefined && isColorImage) {
    bitsStored = 8;
  }
  if (highBit === undefined && isColorImage) {
    highBit = 7;
  }

  // Final fallbacks for grayscale
  if (bitsAllocated === undefined) bitsAllocated = 16;
  if (bitsStored === undefined) bitsStored = 16;
  if (highBit === undefined) highBit = 15;

  // Check for explicit palette descriptors / UID on the instance. If present,
  // prefer PALETTE COLOR when SamplesPerPixel === 1.
  const hasPaletteDescriptors =
    (instance as any).RedPaletteColorLookupTableDescriptor ||
    (instance as any).GreenPaletteColorLookupTableDescriptor ||
    (instance as any).BluePaletteColorLookupTableDescriptor ||
    (instance as any).PaletteColorLookupTableUID;

  // Log palette detection
  if (hasPaletteDescriptors) {
    console.log('[MADO Synthesis] Palette descriptors detected on instance:', {
      sopInstanceUID: (instance as any).sopInstanceUID?.substring(0, 20) + '...',
      currentPhotometric: photometricInterpretation,
      samplesPerPixel,
      hasPaletteDescriptors: true,
    });
  }

  // Conservative photometric derivation:
  // - If PhotometricInterpretation explicitly present, respect it.
  // - Otherwise, if SamplesPerPixel === 3 -> RGB; if SamplesPerPixel === 1 and palette descriptors exist -> PALETTE COLOR;
  // - Otherwise fall back to modality defaults or MONOCHROME2.
  if (!((instance as any).PhotometricInterpretation)) {
    if (samplesPerPixel === 3) {
      photometricInterpretation = 'RGB';
    } else if (samplesPerPixel === 1 && hasPaletteDescriptors) {
      photometricInterpretation = 'PALETTE COLOR';
      console.log('[MADO Synthesis] ✅ Setting PhotometricInterpretation to PALETTE COLOR based on descriptors');
    } else {
      photometricInterpretation = modalityPhysics.PhotometricInterpretation || 'MONOCHROME2';
    }
  } else if (hasPaletteDescriptors && String((instance as any).PhotometricInterpretation).toUpperCase() !== 'PALETTE COLOR') {
    // If we have palette descriptors but PhotometricInterpretation is set to something else,
    // log a warning since this might be a data inconsistency
    console.warn('[MADO Synthesis] ⚠️ Instance has palette descriptors but PhotometricInterpretation is:', (instance as any).PhotometricInterpretation);
  }

  // Window/Level from prefetched or modality defaults
  let windowCenter = (instance as any).WindowCenter || modalityPhysics.WindowCenter || 128;
  let windowWidth = (instance as any).WindowWidth || modalityPhysics.WindowWidth || 256;
  let rescaleIntercept = (instance as any).RescaleIntercept ?? modalityPhysics.RescaleIntercept ?? 0;
  let rescaleSlope = (instance as any).RescaleSlope ?? modalityPhysics.RescaleSlope ?? 1;
  let rescaleType = (instance as any).RescaleType || modalityPhysics.RescaleType;

  if (hasPrefetchedMetadata) {
    console.log(`✅ [MADO Synthesis] Using prefetched metadata for instance ${(instance as any).sopInstanceUID?.substring(0, 20)}...`);
  }

  // Robust color detection for MR: check for color hints in instance or manifest
  const isLikelyColorMR =
    modality === 'MR' && (
      (displaySet as any).forceColor ||
      (instance as any).forceColor ||
      (samplesPerPixel === 3) ||
      (photometricInterpretation && (photometricInterpretation.startsWith('RGB') || photometricInterpretation.startsWith('YBR')))
    );
  if (isLikelyColorMR) {
    samplesPerPixel = 3;
    photometricInterpretation = photometricInterpretation?.startsWith('YBR') ? photometricInterpretation : 'RGB';
  }

  const metadata: any = {
    SOPClassUID: sopClass,
    SOPInstanceUID: (instance as any).sopInstanceUID,
    InstanceNumber: (instance as any).instanceNumber || context.index + 1,
    SpecificCharacterSet: 'ISO_IR 192',

    PatientName: (displaySet as any).patientName || 'Anonymous',
    PatientID: (displaySet as any).patientID || 'UNKNOWN',
    StudyInstanceUID: (displaySet as any).studyInstanceUID,
    SeriesInstanceUID: (displaySet as any).seriesInstanceUID,
    SeriesNumber: parseInt((displaySet as any).seriesNumber as any) || 1,
    Modality: modality,

    Rows: (instance as any).rows || 512,
    Columns: (instance as any).columns || 512,
    PixelSpacing: pixelSpacing,
    SliceThickness: sliceThickness,
    ImageOrientationPatient: orientation,
    ImagePositionPatient:
      (instance as any).imagePositionPatient ||
      (instance as any).ImagePositionPatient ||
      [0, 0, context.index * sliceThickness],
    FrameOfReferenceUID:
      (instance as any).FrameOfReferenceUID ||
      (displaySet as any).frameOfReferenceUID ||
      `${(displaySet as any).seriesInstanceUID}.1`,

    // Pixel module - use prefetched values (already computed with priority)
    BitsAllocated: bitsAllocated,
    BitsStored: bitsStored,
    HighBit: highBit,
    PixelRepresentation: pixelRepresentation,
    SamplesPerPixel: samplesPerPixel,
    PhotometricInterpretation: photometricInterpretation,

    // Window/Level - use prefetched values
    WindowCenter: windowCenter,
    WindowWidth: windowWidth,
    RescaleIntercept: rescaleIntercept,
    RescaleSlope: rescaleSlope,
    RescaleType: rescaleType,

    // Palette Color Lookup Table
    RedPaletteColorLookupTableDescriptor: (instance as any).RedPaletteColorLookupTableDescriptor || (instance as any).redPaletteColorLookupTableDescriptor,
    GreenPaletteColorLookupTableDescriptor: (instance as any).GreenPaletteColorLookupTableDescriptor || (instance as any).greenPaletteColorLookupTableDescriptor,
    BluePaletteColorLookupTableDescriptor: (instance as any).BluePaletteColorLookupTableDescriptor || (instance as any).bluePaletteColorLookupTableDescriptor,
    RedPaletteColorLookupTableData: (instance as any).RedPaletteColorLookupTableData || (instance as any).redPaletteColorLookupTableData,
    GreenPaletteColorLookupTableData: (instance as any).GreenPaletteColorLookupTableData || (instance as any).greenPaletteColorLookupTableData,
    BluePaletteColorLookupTableData: (instance as any).BluePaletteColorLookupTableData || (instance as any).bluePaletteColorLookupTableData,
    PaletteColorLookupTableUID: (instance as any).PaletteColorLookupTableUID || (instance as any).paletteColorLookupTableUID,

    // Segmented Palette Color Lookup Table (0028,1221-1223)
    SegmentedRedPaletteColorLookupTableData: (instance as any).SegmentedRedPaletteColorLookupTableData || (instance as any).segmentedRedPaletteColorLookupTableData,
    SegmentedGreenPaletteColorLookupTableData: (instance as any).SegmentedGreenPaletteColorLookupTableData || (instance as any).segmentedGreenPaletteColorLookupTableData,
    SegmentedBluePaletteColorLookupTableData: (instance as any).SegmentedBluePaletteColorLookupTableData || (instance as any).segmentedBluePaletteColorLookupTableData,

    // NEW: Additional fields for DICOM-JSON parity

    // Pixel module extras
    PlanarConfiguration: (instance as any).PlanarConfiguration,
    PixelAspectRatio: (instance as any).PixelAspectRatio,
    SmallestPixelValue: (instance as any).SmallestPixelValue,
    LargestPixelValue: (instance as any).LargestPixelValue,

    // Image plane extras
    ImagerPixelSpacing: (instance as any).ImagerPixelSpacing || (instance as any).imagerPixelSpacing,
    SliceLocation: (instance as any).SliceLocation || (instance as any).sliceLocation,
    SpacingBetweenSlices: (instance as any).SpacingBetweenSlices,

    // VOI LUT extras
    VOILUTFunction: (instance as any).VOILUTFunction,

    // Multi-frame extras
    NumberOfFrames: (instance as any).NumberOfFrames || (instance as any).numberOfFrames,
    FrameTime: (instance as any).FrameTime,
    FrameIncrementPointer: (instance as any).FrameIncrementPointer,
    PerFrameFunctionalGroupsSequence: (instance as any).PerFrameFunctionalGroupsSequence,
    SharedFunctionalGroupsSequence: (instance as any).SharedFunctionalGroupsSequence,

    // Image identification
    ImageType: (instance as any).ImageType,
    AcquisitionNumber: (instance as any).AcquisitionNumber,
    AcquisitionDate: (instance as any).AcquisitionDate,
    AcquisitionTime: (instance as any).AcquisitionTime,

    // Lossy compression info
    LossyImageCompression: (instance as any).LossyImageCompression,
    LossyImageCompressionRatio: (instance as any).LossyImageCompressionRatio,
    LossyImageCompressionMethod: (instance as any).LossyImageCompressionMethod,

    // Ultrasound calibration sequence
    SequenceOfUltrasoundRegions: (instance as any).SequenceOfUltrasoundRegions,

    // PET specific fields
    CorrectedImage: (instance as any).CorrectedImage,
    Units: (instance as any).Units,
    DecayCorrection: (instance as any).DecayCorrection,
    FrameReferenceTime: (instance as any).FrameReferenceTime,
    ActualFrameDuration: (instance as any).ActualFrameDuration,
    RadiopharmaceuticalInformationSequence: (instance as any).RadiopharmaceuticalInformationSequence,

    // Study-level fields (carried from displaySet for completeness)
    StudyDescription: (displaySet as any).studyDescription,
    StudyDate: (displaySet as any).studyDate,
    StudyTime: (displaySet as any).studyTime,
    AccessionNumber: (displaySet as any).accessionNumber,
    StudyID: (displaySet as any).studyID || '',

    // Series-level fields
    SeriesDescription: (displaySet as any).seriesDescription,
    SeriesDate: (displaySet as any).seriesDate,
    SeriesTime: (displaySet as any).seriesTime,

    // Patient study module fields
    PatientAge: (displaySet as any).patientAge,
    PatientSize: (displaySet as any).patientSize,
    PatientWeight: (displaySet as any).patientWeight,
    PatientSex: (displaySet as any).patientSex,
    PatientBirthDate: (displaySet as any).patientBirthDate,

    // Internal OHIF fields (underscore prefix to mark as non-DICOM)
    _wadoRoot: context.wadoRoot,
    _wadoUri: context.wadoUri,
    _imageId: context.imageId,
    TransferSyntaxUID: (instance as any).TransferSyntaxUID || '1.2.840.10008.1.2.1',
    _isSynthesized: true,
    _synthesizedFromMado: true,
    _hasPrefetchedMetadata: hasPrefetchedMetadata,
  };

  // Compute _geometryPatched based on whether we have valid geometry in the synthesized metadata
  // This is crucial for allowing 3D reconstruction
  const synthesizedIPP = metadata.ImagePositionPatient;
  const synthesizedIOP = metadata.ImageOrientationPatient;
  const synthesizedPixelSpacing = metadata.PixelSpacing;
  const hasValidSynthesizedGeometry =
    metadata.Rows && metadata.Columns &&
    Array.isArray(synthesizedIPP) && synthesizedIPP.length === 3 &&
    Array.isArray(synthesizedIOP) && synthesizedIOP.length === 6 &&
    Array.isArray(synthesizedPixelSpacing) && synthesizedPixelSpacing.length === 2 &&
    // Ensure IPP has non-default values (not all zeros unless it's the first slice at origin)
    (hasPrefetchedMetadata || (instance as any)._geometryPatched ||
     (synthesizedIPP[0] !== 0 || synthesizedIPP[1] !== 0 || synthesizedIPP[2] !== 0 || context.index === 0));

  metadata._geometryPatched = (instance as any)._geometryPatched || hasValidSynthesizedGeometry;

  // --- Conditional sequences for special modalities (SR, RT, SEG, etc.) ---
  // These are passed through if they exist on the instance

  // Structured Report sequences
  if ((instance as any).ConceptNameCodeSequence) {
    metadata.ConceptNameCodeSequence = (instance as any).ConceptNameCodeSequence;
  }
  if ((instance as any).ContentSequence) {
    metadata.ContentSequence = (instance as any).ContentSequence;
  }
  if ((instance as any).ContentTemplateSequence) {
    metadata.ContentTemplateSequence = (instance as any).ContentTemplateSequence;
  }
  if ((instance as any).CurrentRequestedProcedureEvidenceSequence) {
    metadata.CurrentRequestedProcedureEvidenceSequence = (instance as any).CurrentRequestedProcedureEvidenceSequence;
  }
  if ((instance as any).CodingSchemeIdentificationSequence) {
    metadata.CodingSchemeIdentificationSequence = (instance as any).CodingSchemeIdentificationSequence;
  }

  // RT Structure Set sequences
  if ((instance as any).ROIContourSequence) {
    metadata.ROIContourSequence = (instance as any).ROIContourSequence;
  }
  if ((instance as any).StructureSetROISequence) {
    metadata.StructureSetROISequence = (instance as any).StructureSetROISequence;
  }
  if ((instance as any).ReferencedFrameOfReferenceSequence) {
    metadata.ReferencedFrameOfReferenceSequence = (instance as any).ReferencedFrameOfReferenceSequence;
  }

  // Referenced series/instance sequences
  if ((instance as any).ReferencedSeriesSequence) {
    metadata.ReferencedSeriesSequence = (instance as any).ReferencedSeriesSequence;
  }

  // Encapsulated document (PDF, etc.)
  if ((instance as any).EncapsulatedDocument) {
    metadata.EncapsulatedDocument = (instance as any).EncapsulatedDocument;
  }
  if ((instance as any).MIMETypeOfEncapsulatedDocument) {
    metadata.MIMETypeOfEncapsulatedDocument = (instance as any).MIMETypeOfEncapsulatedDocument;
  }

  // Debug log palette color data
  if (metadata.RedPaletteColorLookupTableDescriptor || metadata.PaletteColorLookupTableUID || metadata.SegmentedRedPaletteColorLookupTableData) {
    console.log('[MADO Synthesis] ✅ Instance has palette color data:', {
      sopInstanceUID: (instance as any).sopInstanceUID?.substring(0, 20) + '...',
      photometricInterpretation: metadata.PhotometricInterpretation,
      redDescriptor: metadata.RedPaletteColorLookupTableDescriptor,
      greenDescriptor: metadata.GreenPaletteColorLookupTableDescriptor,
      blueDescriptor: metadata.BluePaletteColorLookupTableDescriptor,
      redDataLength: metadata.RedPaletteColorLookupTableData?.length,
      greenDataLength: metadata.GreenPaletteColorLookupTableData?.length,
      blueDataLength: metadata.BluePaletteColorLookupTableData?.length,
      segmentedRedLength: metadata.SegmentedRedPaletteColorLookupTableData?.length,
      segmentedGreenLength: metadata.SegmentedGreenPaletteColorLookupTableData?.length,
      segmentedBlueLength: metadata.SegmentedBluePaletteColorLookupTableData?.length,
      uid: metadata.PaletteColorLookupTableUID,
    });
  } else if (photometricInterpretation === 'PALETTE COLOR') {
    console.warn('[MADO Synthesis] ⚠️ PhotometricInterpretation is PALETTE COLOR but no palette data found on instance!', {
      sopInstanceUID: (instance as any).sopInstanceUID?.substring(0, 20) + '...',
      instanceKeys: Object.keys(instance as any).filter(k => k.toLowerCase().includes('palette')),
    });
  }

  // --- Force color metadata for color MR images ---
  const instAny = instance as any;
  if (
    instAny.Modality === 'MR' &&
    instAny.numberOfFrames > 1 &&
    (
      instAny.SamplesPerPixel === 3 ||
      (instAny.PhotometricInterpretation &&
        (instAny.PhotometricInterpretation.startsWith('YBR') ||
          instAny.PhotometricInterpretation.startsWith('RGB')))
    )
  ) {
    // Only force MR color if the instance is not a palette-color image.
    const instHasPalette = instAny.RedPaletteColorLookupTableDescriptor || instAny.PaletteColorLookupTableUID;
    if (!instHasPalette) {
      instAny.SamplesPerPixel = 3;
      instAny.PhotometricInterpretation = 'RGB';
      console.log('[MADO] Synthesized color MR metadata', instance);
    } else {
      console.log('[MADO] MR instance has palette descriptors; preserving palette photometric interpretation', instance);
    }
  }

  // Debug: log synthesized metadata for this instance
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    //TODO: debug logging
    console.log('[MADO] Synthesized metadata:', metadata);
  }

  patchTechnicalAttributes(metadata, instance);

  return metadata;
}

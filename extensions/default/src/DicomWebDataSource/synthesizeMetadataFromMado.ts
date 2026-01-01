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
  },
  XA: { BitsAllocated: 8, BitsStored: 8, HighBit: 7 },
  // Slide microscopy / whole slide imaging
  SM: {
    SamplesPerPixel: 3,
    PhotometricInterpretation: 'YBR_FULL',
    PlanarConfiguration: 0,
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
    PatientName: displaySet.patientName || 'Anonymous',
    PatientID: displaySet.patientID || 'UNKNOWN',
    PatientBirthDate: displaySet.patientBirthDate || '',
    PatientSex: displaySet.patientSex || 'O',
    StudyDescription: displaySet.studyDescription || '',
    StudyDate: displaySet.studyDate || '',
    StudyTime: displaySet.studyTime || '',
    AccessionNumber: displaySet.accessionNumber || '',
    _isSynthesized: true,
  };
}

/**
 * Creates instance-level metadata with physical defaults based on SOP Class.
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

  const pixelSpacing = validateSpacing(
    (instance as any).pixelSpacing || (instance as any).imagerPixelSpacing || [1.0, 1.0]
  );

  const orientation =
    (instance as any).imageOrientationPatient || (instance as any).ImageOrientationPatient || [1, 0, 0, 0, 1, 0];

  const sliceThickness = (instance as any).sliceThickness || (instance as any).SliceThickness || 1.0;

  // --- COLOR MR OVERRIDE LOGIC ---
  // If displaySet or instance has forceColor, treat as color MR
  let samplesPerPixel = modalityPhysics.SamplesPerPixel || 1;
  let photometricInterpretation = modalityPhysics.PhotometricInterpretation || 'MONOCHROME2';

  // --- COLOR AND PIXEL MODULE LOGIC ---
  // Always prefer explicit values from the instance if present
  if (instance?.SamplesPerPixel) {
    samplesPerPixel = instance.SamplesPerPixel;
  }
  if (instance?.PhotometricInterpretation) {
    photometricInterpretation = instance.PhotometricInterpretation;
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
      (displaySet as any).frameOfReferenceUID || `${(displaySet as any).seriesInstanceUID}.1`,

    BitsAllocated: modalityPhysics.BitsAllocated || 16,
    BitsStored: modalityPhysics.BitsStored || 16,
    HighBit: modalityPhysics.HighBit || 15,
    PixelRepresentation: modalityPhysics.PixelRepresentation ?? 0,
    SamplesPerPixel: samplesPerPixel,
    PhotometricInterpretation: photometricInterpretation,

    WindowCenter: modalityPhysics.WindowCenter || 128,
    WindowWidth: modalityPhysics.WindowWidth || 256,
    RescaleIntercept: modalityPhysics.RescaleIntercept ?? 0,
    RescaleSlope: modalityPhysics.RescaleSlope ?? 1,
    RescaleType: modalityPhysics.RescaleType,

    // Internal OHIF fields (underscore prefix to mark as non-DICOM)
    _wadoRoot: context.wadoRoot,
    _wadoUri: context.wadoUri,
    _imageId: context.imageId,
    TransferSyntaxUID: '1.2.840.10008.1.2.1',
    _isSynthesized: true,
    _synthesizedFromMado: true,
  };

  // --- Force color metadata for color MR images ---
  if (
    instance.Modality === 'MR' &&
    instance.NumberOfFrames > 1 &&
    (
      instance.SamplesPerPixel === 3 ||
      (instance.PhotometricInterpretation &&
        (instance.PhotometricInterpretation.startsWith('YBR') ||
          instance.PhotometricInterpretation.startsWith('RGB')))
    )
  ) {
    instance.SamplesPerPixel = 3;
    instance.PhotometricInterpretation = 'RGB';
    console.log('[MADO] Synthesized color MR metadata', instance);
  }

  // Debug: log synthesized metadata for this instance
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[MADO] Synthesized metadata:', metadata);
  }

  patchTechnicalAttributes(metadata, instance);

  return metadata;
}

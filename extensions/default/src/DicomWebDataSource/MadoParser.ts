import dcmjs from 'dcmjs';

const { DicomMessage } = dcmjs.data;

export interface MadoInstance {
  sopClassUID: string;
  sopInstanceUID: string;
  instanceNumber?: number;
  wadoRoot?: string | null;
  numberOfFrames?: number;
  rows?: number;
  columns?: number;

  // Prefetched metadata fields (populated by prefetchSeriesMetadata)
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

  // Image plane fields
  pixelSpacing?: number[];
  PixelSpacing?: number[];
  ImagerPixelSpacing?: number[];
  imagerPixelSpacing?: number[];
  imageOrientationPatient?: number[];
  ImageOrientationPatient?: number[];
  imagePositionPatient?: number[];
  ImagePositionPatient?: number[];
  sliceThickness?: number;
  SliceThickness?: number;
  SliceLocation?: number;
  sliceLocation?: number;
  SpacingBetweenSlices?: number;

  // VOI LUT fields
  WindowCenter?: number | number[];
  WindowWidth?: number | number[];
  RescaleIntercept?: number;
  RescaleSlope?: number;
  RescaleType?: string;
  VOILUTFunction?: string;

  // Frame of reference
  FrameOfReferenceUID?: string;
  TransferSyntaxUID?: string;

  // Multi-frame support
  NumberOfFrames?: number;
  FrameTime?: number;
  FrameIncrementPointer?: string;
  PerFrameFunctionalGroupsSequence?: any[];
  SharedFunctionalGroupsSequence?: any[];

  // Image identification
  ImageType?: string[];
  AcquisitionNumber?: number;
  AcquisitionDate?: string;
  AcquisitionTime?: string;

  // Lossy compression info
  LossyImageCompression?: string;
  LossyImageCompressionRatio?: number;
  LossyImageCompressionMethod?: string;

  // Palette Color Lookup Table fields
  RedPaletteColorLookupTableDescriptor?: number[];
  GreenPaletteColorLookupTableDescriptor?: number[];
  BluePaletteColorLookupTableDescriptor?: number[];
  RedPaletteColorLookupTableData?: number[];
  GreenPaletteColorLookupTableData?: number[];
  BluePaletteColorLookupTableData?: number[];
  PaletteColorLookupTableUID?: string;
  // camelCase aliases for compatibility
  redPaletteColorLookupTableDescriptor?: number[];
  greenPaletteColorLookupTableDescriptor?: number[];
  bluePaletteColorLookupTableDescriptor?: number[];
  redPaletteColorLookupTableData?: number[];
  greenPaletteColorLookupTableData?: number[];
  bluePaletteColorLookupTableData?: number[];
  paletteColorLookupTableUID?: string;

  // Segmented Palette Color Lookup Table (0028,1221-1223)
  SegmentedRedPaletteColorLookupTableData?: number[];
  SegmentedGreenPaletteColorLookupTableData?: number[];
  SegmentedBluePaletteColorLookupTableData?: number[];
  // camelCase aliases
  segmentedRedPaletteColorLookupTableData?: number[];
  segmentedGreenPaletteColorLookupTableData?: number[];
  segmentedBluePaletteColorLookupTableData?: number[];

  // Ultrasound calibration
  SequenceOfUltrasoundRegions?: any[];

  // PET specific fields
  CorrectedImage?: string[];
  Units?: string;
  DecayCorrection?: string;
  FrameReferenceTime?: number;
  ActualFrameDuration?: number;
  RadiopharmaceuticalInformationSequence?: any[];

  // Internal flags
  _prefetchedMetadata?: boolean;
}

export interface MadoDisplaySet {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  seriesDescription: string;
  seriesDate?: string;
  seriesTime?: string;
  seriesNumber?: string;
  modality?: string;
  numberOfSeriesRelatedInstances?: number;
  instances: MadoInstance[];

  // Patient Module
  patientID?: string;
  patientName?: string;
  patientBirthDate?: string;
  patientSex?: string;

  // Patient Study Module
  patientAge?: string;
  patientSize?: number;
  patientWeight?: number;

  // Study Module
  studyDescription?: string;
  studyDate?: string;
  studyTime?: string;
  accessionNumber?: string;
  studyID?: string;

  // Frame of Reference
  frameOfReferenceUID?: string;

  // WADO retrieval
  retrieveURL?: string;
}

/**
 * MadoParser
 * Specifically designed to extract UIDs from the MADO KOS format
 * to support WADO-RS only workflows (without QIDO-RS).
 *
 * The MADO file is a Key Object Selection (KOS) document that contains
 * references to DICOM instances but lacks the full rendering metadata.
 */
class MadoParser {
  /**
   * Parses the binary MADO file
   * @param {ArrayBuffer} arrayBuffer - The raw DICOM P10 file buffer
   * @returns {MadoDisplaySet[]} Array of display sets extracted from the manifest
   */
  static parse(arrayBuffer: ArrayBuffer): MadoDisplaySet[] {
    const dicomData = DicomMessage.readFile(arrayBuffer);
    const dataset = dicomData.dict;

    // 1. Extract Top-Level Study and Patient Info
    const studyInstanceUID = dataset['0020000D']?.Value?.[0];
    const patientName = dataset['00100010']?.Value?.[0]?.Alphabetic || 'Anonymous';
    const patientID = dataset['00100020']?.Value?.[0];
    const patientBirthDate = dataset['00100030']?.Value?.[0];
    const patientSex = dataset['00100040']?.Value?.[0];
    const studyDate = dataset['00080020']?.Value?.[0];
    const studyTime = dataset['00080030']?.Value?.[0];
    const studyDescription = dataset['00081030']?.Value?.[0];
    const accessionNumber = dataset['00080050']?.Value?.[0];

    // Additional study/patient fields that might be present in MADO
    const studyID = dataset['00200010']?.Value?.[0]; // Study ID
    const patientAge = dataset['00101010']?.Value?.[0]; // Patient Age
    const patientSize = dataset['00101020']?.Value?.[0]; // Patient Size (height)
    const patientWeight = dataset['00101030']?.Value?.[0]; // Patient Weight

    if (!studyInstanceUID) {
      throw new Error('MADO file is missing required StudyInstanceUID (0020,000D)');
    }

    console.log('MADO Parser: Extracted study-level metadata', {
      studyInstanceUID,
      patientID,
      patientName,
      studyDate,
      studyDescription,
    });

    // 2. Access the Evidence Sequence (The core of MADO)
    // Tag (0040,A375) Current Requested Procedure Evidence Sequence
    const evidenceSequence = dataset['0040A375']?.Value || [];

    if (evidenceSequence.length === 0) {
      console.warn('MADO file contains no evidence sequence items');
    }

    const displaySetsToLoad: MadoDisplaySet[] = [];

    // 3. Also look in Content Sequence (0040,A730) for additional metadata
    const contentSequence = dataset['0040A730']?.Value || [];

  // DDD Code Constants (from MADO specification):
  // ddd002: Series Description
  // ddd003: Series Date
  // ddd004: Series Time
  // ddd005: Series Number
  // ddd006: Series Instance UID
  // ddd007: Number of Series Related Instances
  // ddd008: Instance Number

  // Helper to extract text value from content sequence by code
  const findTextValueByCode = (sequence, codeValue) => {
      const item = sequence.find(
        item =>
          item['0040A043']?.Value?.[0]?.['00080100']?.Value?.[0] === codeValue &&
          item['0040A040']?.Value?.[0] === 'TEXT'
      );
      return item?.['0040A160']?.Value?.[0];
    };

    // Helper to extract numeric value from content sequence by code
    const findNumericValueByCode = (sequence, codeValue) => {
      const item = sequence.find(
        item =>
          item['0040A043']?.Value?.[0]?.['00080100']?.Value?.[0] === codeValue &&
          item['0040A040']?.Value?.[0] === 'NUM'
      );
      return item?.['0040A300']?.Value?.[0]?.['0040A30A']?.Value?.[0];
    };

    // Helper to find modality from content sequence
    const findModalityFromContent = sequence => {
      const item = sequence.find(
        item =>
          item['0040A043']?.Value?.[0]?.['00080100']?.Value?.[0] === '121139' &&
          item['0040A040']?.Value?.[0] === 'CODE'
      );
      return item?.['0040A168']?.Value?.[0]?.['00080100']?.Value?.[0];
    };

    evidenceSequence.forEach(studyItem => {
      // Navigate to Referenced Series Sequence (0008,1115)
      const referencedSeriesSequence = studyItem['00081115']?.Value || [];

      referencedSeriesSequence.forEach(seriesItem => {
        const seriesInstanceUID = seriesItem['0020000E']?.Value?.[0];
        const seriesDescription = seriesItem['0008103E']?.Value?.[0] || 'MADO Series';
        const modality = seriesItem['00080060']?.Value?.[0];

        if (!seriesInstanceUID) {
          console.warn('Skipping series item without SeriesInstanceUID');
          return;
        }

        // RetrieveURL (0008,1190) is vital for WADO-RS access
        const retrieveURL = seriesItem['00081190']?.Value?.[0];

        // Navigate to Referenced SOP Sequence (0008,1199)
        const referencedSOPSequence = seriesItem['00081199']?.Value || [];

        const instances: MadoInstance[] = referencedSOPSequence.map(sopItem => {
          const sopClassUID = sopItem['00081150']?.Value?.[0] || '';
          const sopInstanceUID = sopItem['00081155']?.Value?.[0] || '';


          return {
            sopClassUID,
            sopInstanceUID,
            instanceNumber: sopItem['00200013']?.Value?.[0], // If available
            numberOfFrames: sopItem['00280008']?.Value?.[0],
            rows: sopItem['00280010']?.Value?.[0],
            columns: sopItem['00280011']?.Value?.[0],
            // Map the WADO-RS root from the RetrieveURL if present
            wadoRoot: retrieveURL ? retrieveURL.split('/studies')[0] : null,
          };
        });

        // Filter out any instances with missing required UIDs
        const validInstances = instances.filter(
          inst => inst.sopClassUID && inst.sopInstanceUID
        );

        if (validInstances.length > 0) {
          // Try to extract additional series and instance metadata from content sequence
          // Look for Image Library Group containers
          let seriesDate = null;
          let seriesTime = null;
          let seriesNumber = null;
          let numberOfSeriesRelatedInstances = null;
          const instanceMetadataMap = new Map<string, { instanceNumber?: number }>();

          // Search through content sequence for series-specific and instance-specific metadata
          contentSequence.forEach(contentItem => {
            if (contentItem['0040A040']?.Value?.[0] === 'CONTAINER') {
              const nestedContent = contentItem['0040A730']?.Value || [];
              nestedContent.forEach(nestedItem => {
                if (nestedItem['0040A040']?.Value?.[0] === 'CONTAINER') {
                  const groupContent = nestedItem['0040A730']?.Value || [];

                  // Check if this group matches our series
                  const groupSeriesUID = groupContent.find(
                    item =>
                      item['0040A043']?.Value?.[0]?.['00080100']?.Value?.[0] === 'ddd006' &&
                      item['0040A040']?.Value?.[0] === 'UIDREF'
                  )?.['0040A124']?.Value?.[0];

                  if (groupSeriesUID === seriesInstanceUID) {
                    seriesDate = findTextValueByCode(groupContent, 'ddd003');
                    seriesTime = findTextValueByCode(groupContent, 'ddd004');
                    seriesNumber = findTextValueByCode(groupContent, 'ddd005');
                    numberOfSeriesRelatedInstances = findNumericValueByCode(
                      groupContent,
                      'ddd007'
                    );

                    // Extract instance-level metadata from IMAGE items in the group
                    groupContent.forEach(imageItem => {
                      if (imageItem['0040A040']?.Value?.[0] === 'IMAGE') {
                        // Get the ReferencedSOPSequence to find the SOP Instance UID
                        const refSOPSeq = imageItem['00081199']?.Value || [];
                        if (refSOPSeq.length > 0) {
                          const sopInstanceUID = refSOPSeq[0]['00081155']?.Value?.[0];

                          // Look in the nested ContentSequence for instance number
                          const imageContent = imageItem['0040A730']?.Value || [];
                          const instanceNumberText = findTextValueByCode(imageContent, 'ddd008');

                          if (sopInstanceUID && instanceNumberText) {
                            const parsed = parseInt(instanceNumberText, 10);
                            instanceMetadataMap.set(sopInstanceUID, {
                              instanceNumber: parsed,
                            });
                          }
                        }
                      }
                    });
                  }
                }
              });
            }
          });

          // Enrich instances with metadata from Content Sequence
          let enrichedCount = 0;
          validInstances.forEach(instance => {
            const enrichedMetadata = instanceMetadataMap.get(instance.sopInstanceUID);
            if (enrichedMetadata?.instanceNumber !== undefined) {
              instance.instanceNumber = enrichedMetadata.instanceNumber;
              enrichedCount++;
            }
          });
          if (enrichedCount > 0) {
            console.log(`  📋 Enriched ${enrichedCount}/${validInstances.length} instances with instanceNumber from MADO`);
          }

          // Sort instances by instance number for proper ordering
          validInstances.sort((a, b) => {
            const numA = a.instanceNumber ?? 999999;
            const numB = b.instanceNumber ?? 999999;
            return numA - numB;
          });

          displaySetsToLoad.push({
            studyInstanceUID,
            seriesInstanceUID,
            seriesDescription,
            seriesDate: seriesDate || studyDate,
            seriesTime: seriesTime || studyTime,
            seriesNumber,
            modality: modality || findModalityFromContent(contentSequence),
            numberOfSeriesRelatedInstances:
              numberOfSeriesRelatedInstances || validInstances.length,
            instances: validInstances,
            patientID,
            patientName,
            patientBirthDate,
            patientSex,
            patientAge,
            patientSize: patientSize ? parseFloat(patientSize) : undefined,
            patientWeight: patientWeight ? parseFloat(patientWeight) : undefined,
            studyDescription,
            studyDate,
            studyTime,
            accessionNumber,
            studyID,
            retrieveURL,
          });

          console.log('MADO Parser: Extracted series metadata', {
            seriesInstanceUID,
            seriesDescription,
            modality,
            instanceCount: validInstances.length,
          });
        }
      });
    });

    return displaySetsToLoad;
  }

  /**
   * Fetches a MADO manifest from a URL
   * @param {string} manifestUrl - The URL to fetch the MADO file from
   * @param {HeadersInit} headers - Optional headers for authentication
   * @returns {Promise<ArrayBuffer>} The raw DICOM file buffer
   */
  static async fetchManifest(
    manifestUrl: string,
    headers?: HeadersInit
  ): Promise<ArrayBuffer> {
    try {
      const response = await fetch(manifestUrl, {
        method: 'GET',
        headers: {
          ...headers,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch MADO manifest: ${response.status} ${response.statusText}`
        );
      }

      return await response.arrayBuffer();
    } catch (error) {
      console.error('Error fetching MADO manifest:', error);
      throw error;
    }
  }

  /**
   * Validates that the parsed MADO data has the expected structure
   * @param {MadoDisplaySet[]} displaySets - The parsed display sets
   * @returns {boolean} True if valid
   */
  static validate(displaySets: MadoDisplaySet[]): boolean {
    if (!Array.isArray(displaySets) || displaySets.length === 0) {
      console.error('MADO validation failed: No display sets found');
      return false;
    }

    for (const ds of displaySets) {
      if (!ds.studyInstanceUID || !ds.seriesInstanceUID) {
        console.error('MADO validation failed: Missing required UIDs', ds);
        return false;
      }
      if (!Array.isArray(ds.instances) || ds.instances.length === 0) {
        console.error('MADO validation failed: No instances in series', ds);
        return false;
      }
    }

    return true;
  }
}

export default MadoParser;


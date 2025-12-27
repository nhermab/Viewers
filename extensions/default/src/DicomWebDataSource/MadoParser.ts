import dcmjs from 'dcmjs';

const { DicomMessage } = dcmjs.data;

export interface MadoInstance {
  sopClassUID: string;
  sopInstanceUID: string;
  instanceNumber?: number;
  wadoRoot?: string | null;
}

export interface MadoDisplaySet {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  seriesDescription: string;
  instances: MadoInstance[];
  patientID?: string;
  patientName?: string;
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

    // 1. Extract Top-Level Study Info
    const studyInstanceUID = dataset['0020000D']?.Value?.[0];
    const patientName = dataset['00100010']?.Value?.[0]?.Alphabetic || 'Anonymous';
    const patientID = dataset['00100020']?.Value?.[0];

    if (!studyInstanceUID) {
      throw new Error('MADO file is missing required StudyInstanceUID (0020,000D)');
    }

    // 2. Access the Evidence Sequence (The core of MADO)
    // Tag (0040,A375) Current Requested Procedure Evidence Sequence
    const evidenceSequence = dataset['0040A375']?.Value || [];

    if (evidenceSequence.length === 0) {
      console.warn('MADO file contains no evidence sequence items');
    }

    const displaySetsToLoad: MadoDisplaySet[] = [];

    evidenceSequence.forEach(studyItem => {
      // Navigate to Referenced Series Sequence (0008,1115)
      const referencedSeriesSequence = studyItem['00081115']?.Value || [];

      referencedSeriesSequence.forEach(seriesItem => {
        const seriesInstanceUID = seriesItem['0020000E']?.Value?.[0];
        const seriesDescription = seriesItem['0008103E']?.Value?.[0] || 'MADO Series';

        if (!seriesInstanceUID) {
          console.warn('Skipping series item without SeriesInstanceUID');
          return;
        }

        // RetrieveURL (0008,1190) is vital since QIDO is disabled
        const retrieveURL = seriesItem['00081190']?.Value?.[0];

        // Navigate to Referenced SOP Sequence (0008,1199)
        const referencedSOPSequence = seriesItem['00081199']?.Value || [];

        const instances: MadoInstance[] = referencedSOPSequence.map(sopItem => {
          return {
            sopClassUID: sopItem['00081150']?.Value?.[0] || '',
            sopInstanceUID: sopItem['00081155']?.Value?.[0] || '',
            instanceNumber: sopItem['00200013']?.Value?.[0], // If available
            // Map the WADO-RS root from the RetrieveURL if present
            wadoRoot: retrieveURL ? retrieveURL.split('/studies')[0] : null,
          };
        });

        // Filter out any instances with missing required UIDs
        const validInstances = instances.filter(
          inst => inst.sopClassUID && inst.sopInstanceUID
        );

        if (validInstances.length > 0) {
          displaySetsToLoad.push({
            studyInstanceUID,
            seriesInstanceUID,
            seriesDescription,
            instances: validInstances,
            patientID,
            patientName,
            retrieveURL,
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


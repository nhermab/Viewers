import { DicomMetadataStore, classes } from '@ohif/core';
import { MadoDisplaySet } from './MadoParser';
import dcmjs from 'dcmjs';
import type { HeadersInterface } from '@ohif/core/src/types/RequestHeaders';

const { DicomMetaDictionary } = dcmjs.data;
const { naturalizeDataset } = DicomMetaDictionary;
const metadataProvider = classes.MetadataProvider;

interface MadoMetadataOptions {
  displaySets: MadoDisplaySet[];
  wadoRoot: string; // Default WADO root if not specified in MADO
  dicomWebClient: any; // DICOMwebClient instance
  getAuthorizationHeader?: () => HeadersInterface;
  getImageIdsForInstance: (params: { instance: any }) => string;
  dicomWebConfig: any;
  madeInClient?: boolean;
}

/**
 * Retrieves full DICOM metadata for series referenced in a MADO manifest.
 * Since MADO files only contain UIDs, this function fetches the complete
 * metadata needed for rendering from the WADO-RS server.
 *
 * @param options - Configuration options for metadata retrieval
 * @returns Promise that resolves when all metadata is loaded
 */
export async function retrieveMadoMetadata(
  options: MadoMetadataOptions
): Promise<void> {
  const {
    displaySets,
    wadoRoot,
    dicomWebClient,
    getAuthorizationHeader,
    getImageIdsForInstance,
    dicomWebConfig,
    madeInClient = false,
  } = options;

  const authHeaders = (typeof getAuthorizationHeader === 'function' ? getAuthorizationHeader() : {}) as HeadersInterface;

  console.log('Starting MADO metadata retrieval for', displaySets.length, 'series');

  const seriesSummaryMetadata = {};
  const instancesPerSeries = {};

  // Process each series in the MADO manifest
  for (const displaySet of displaySets) {
    const { studyInstanceUID, seriesInstanceUID, retrieveURL } = displaySet;

    // Determine the WADO root to use
    // Priority: 1) Series-specific retrieveURL, 2) Default wadoRoot
    const effectiveWadoRoot = displaySet.instances[0]?.wadoRoot || wadoRoot;

    if (!effectiveWadoRoot) {
      console.error(
        `No WADO root available for series ${seriesInstanceUID}. Skipping.`
      );
      continue;
    }

    try {
      // Construct WADO-RS metadata URL
      const metadataUrl = `${effectiveWadoRoot}/studies/${studyInstanceUID}/series/${seriesInstanceUID}/metadata`;

      console.log(`Fetching metadata from: ${metadataUrl}`);

      // Update client headers with current auth (if supported by client)
      if (dicomWebClient && authHeaders) {
        dicomWebClient.headers = authHeaders;
      }

      // Fetch metadata for the entire series
      const response = await fetch(metadataUrl, {
        method: 'GET',
        headers: {
          ...authHeaders,
          Accept: 'application/dicom+json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `WADO-RS metadata request failed: ${response.status} ${response.statusText}`
        );
      }

      const seriesMetadata = await response.json();

      if (!Array.isArray(seriesMetadata) || seriesMetadata.length === 0) {
        console.warn(`No metadata returned for series ${seriesInstanceUID}`);
        continue;
      }

      // Process each instance in the series
      const naturalizedInstances = seriesMetadata.map(instanceMetadata => {
        // Naturalize the dataset (convert DICOM JSON to friendly format)
        const naturalized = naturalizeDataset(instanceMetadata);

        // Add OHIF-specific properties
        naturalized.wadoRoot = effectiveWadoRoot;
        naturalized.wadoUri = dicomWebConfig.wadoUri;

        // Generate image ID for this instance
        const imageId = getImageIdsForInstance({
          instance: naturalized,
        });

        naturalized.imageId = imageId;

        // Register the image ID with metadata provider
        metadataProvider.addImageIdToUIDs(imageId, {
          StudyInstanceUID: studyInstanceUID,
          SeriesInstanceUID: seriesInstanceUID,
          SOPInstanceUID: naturalized.SOPInstanceUID,
        });

        return naturalized;
      });

      // Store series summary metadata
      if (naturalizedInstances.length > 0) {
        const firstInstance = naturalizedInstances[0];

        if (!seriesSummaryMetadata[seriesInstanceUID]) {
          seriesSummaryMetadata[seriesInstanceUID] = {
            StudyInstanceUID: firstInstance.StudyInstanceUID,
            StudyDescription: firstInstance.StudyDescription,
            SeriesInstanceUID: firstInstance.SeriesInstanceUID,
            SeriesDescription: firstInstance.SeriesDescription || displaySet.seriesDescription,
            SeriesNumber: firstInstance.SeriesNumber,
            SeriesTime: firstInstance.SeriesTime,
            SOPClassUID: firstInstance.SOPClassUID,
            ProtocolName: firstInstance.ProtocolName,
            Modality: firstInstance.Modality,
          };
        }

        // Store instances for this series
        if (!instancesPerSeries[seriesInstanceUID]) {
          instancesPerSeries[seriesInstanceUID] = [];
        }
        instancesPerSeries[seriesInstanceUID].push(...naturalizedInstances);
      }

      console.log(
        `Successfully loaded ${naturalizedInstances.length} instances for series ${seriesInstanceUID}`
      );
    } catch (error) {
      console.error(
        `Error retrieving metadata for series ${seriesInstanceUID}:`,
        error
      );
      // Continue processing other series even if one fails
    }
  }

  // Add all metadata to the OHIF store
  const seriesMetadataArray = Object.values(seriesSummaryMetadata);
  if (seriesMetadataArray.length > 0) {
    DicomMetadataStore.addSeriesMetadata(seriesMetadataArray, madeInClient);

    Object.keys(instancesPerSeries).forEach(seriesInstanceUID => {
      DicomMetadataStore.addInstances(instancesPerSeries[seriesInstanceUID], madeInClient);
    });

    console.log(
      `MADO metadata retrieval complete: ${seriesMetadataArray.length} series, ` +
        `${Object.values(instancesPerSeries).flat().length} total instances`
    );
  } else {
    console.warn('No metadata was successfully retrieved from MADO manifest');
  }
}

/**
 * Check if a URL parameter indicates MADO mode
 * @param searchParams - URLSearchParams from the current location
 * @returns The manifest URL if in MADO mode, null otherwise
 */
export function getMadoManifestUrl(searchParams: URLSearchParams): string | null {
  return searchParams.get('manifestUrl') || searchParams.get('madoUrl') || null;
}

export default retrieveMadoMetadata;


import { DicomMetadataStore, classes } from '@ohif/core';
import { MadoDisplaySet } from './MadoParser';
import { synthesizeInstanceMetadata, synthesizeSeriesMetadata } from './synthesizeMetadataFromMado';
import type { HeadersInterface } from '@ohif/core/src/types/RequestHeaders';

const metadataProvider = classes.MetadataProvider;

type UnknownRecord = Record<string, unknown>;

interface MadoMetadataOptions {
  displaySets: MadoDisplaySet[];
  wadoRoot: string; // Default WADO root if not specified in MADO
  dicomWebClient: unknown; // DICOMwebClient instance (opaque here)
  getAuthorizationHeader?: () => HeadersInterface;
  getImageIdsForInstance: (params: { instance: UnknownRecord; frame?: number }) => string;
  dicomWebConfig: { wadoUri: string } & UnknownRecord;
  madeInClient?: boolean;
}

/**
 * Synthesizes and stores DICOM metadata for series referenced in a MADO manifest.
 * This function creates complete metadata from the limited data in the MADO manifest
 * WITHOUT making any /metadata queries to the server.
 *
 * The metadata is synthesized with reasonable defaults based on modality and other
 * available information. This allows WADO-RS-only workflows without QIDO-RS or
 * metadata endpoint dependencies.
 *
 * @param options - Configuration options for metadata synthesis
 * @returns Promise that resolves when all metadata is synthesized and stored
 */
export async function retrieveMadoMetadata(options: MadoMetadataOptions): Promise<void> {
  const {
    displaySets,
    wadoRoot,
    getImageIdsForInstance,
    dicomWebConfig,
    madeInClient = false,
  } = options;

  console.log(
    '🔧 MADO: Synthesizing metadata from manifest for',
    displaySets.length,
    'series (NO /metadata queries)'
  );

  const seriesSummaryMetadata = {};
  const instancesPerSeries = {};

  // Process each series in the MADO manifest
  for (const displaySet of displaySets) {
    const { studyInstanceUID, seriesInstanceUID, instances } = displaySet;

    // Determine the WADO root to use
    // Priority: 1) Instance-specific wadoRoot, 2) Series retrieveURL, 3) Default wadoRoot
    const effectiveWadoRoot =
      instances[0]?.wadoRoot || displaySet.retrieveURL?.split('/studies')[0] || wadoRoot;

    if (!effectiveWadoRoot) {
      console.error(`❌ No WADO root available for series ${seriesInstanceUID}. Skipping.`);
      continue;
    }

    try {
      console.log(
        `🔄 Synthesizing metadata for series ${seriesInstanceUID.substring(0, 20)}... (${instances.length} instances)`
      );

      // Synthesize metadata for each instance
      const synthesizedInstances = instances.map((instance, index) => {
        // Generate image ID for this instance first
        // We need a minimal instance object for getImageIdsForInstance
        const minimalInstance = {
          StudyInstanceUID: studyInstanceUID,
          SeriesInstanceUID: seriesInstanceUID,
          SOPInstanceUID: instance.sopInstanceUID,
          SOPClassUID: instance.sopClassUID,
          // Multi-frame metadata (may be undefined in MADO)
          NumberOfFrames: instance.numberOfFrames,
          wadoRoot: effectiveWadoRoot,
          wadoUri: dicomWebConfig.wadoUri,
        };

        const numberOfFrames = Number(instance.numberOfFrames || 1);

        // Ensure downstream components that consult instance metadata do not assume
        // multi-frame unless explicitly indicated.
        (instance as unknown as { NumberOfFrames?: number }).NumberOfFrames = numberOfFrames;

        let imageId: string | undefined;

        // Only request a specific frame when we truly have a multi-frame object.
        // Otherwise, generating a `/frames/2` imageId for a single-frame instance
        // will fail downstream with "offset is out of bounds".
        if (numberOfFrames > 1) {
          imageId = getImageIdsForInstance({
            instance: minimalInstance,
            frame: 1,
          });
        } else {
          imageId = getImageIdsForInstance({
            instance: minimalInstance,
          });
        }

        // Cornerstone MetadataProvider throws on empty imageId.
        // In some MADO manifests, getImageIdsForInstance may return '' if a field is missing.
        // Provide a deterministic fallback that still lets viewers group instances.
        if (!imageId || typeof imageId !== 'string' || imageId.trim() === '') {
          console.warn('retrieveMadoMetadata: getImageIdsForInstance returned invalid imageId, using fallback', imageId);
          imageId = `mado:${studyInstanceUID}:${seriesInstanceUID}:${instance.sopInstanceUID}`;
        } else {
          console.log('retrieveMadoMetadata: using imageId', imageId);
        }

        const synthesized = synthesizeInstanceMetadata(displaySet, instance, {
          wadoRoot: effectiveWadoRoot,
          wadoUri: dicomWebConfig.wadoUri,
          imageId,
          index,
        });

        // Register UID mappings. For multi-frame, register each frame.
        if (imageId && imageId.trim() !== '') {
          if (numberOfFrames > 1) {
            for (let i = 0; i < numberOfFrames; i++) {
              const frameNumber = i + 1;
              const frameImageId = getImageIdsForInstance({
                instance: minimalInstance,
                frame: frameNumber,
              });

              metadataProvider.addImageIdToUIDs(frameImageId, {
                StudyInstanceUID: studyInstanceUID,
                SeriesInstanceUID: seriesInstanceUID,
                SOPInstanceUID: instance.sopInstanceUID,
                frameNumber,
              });
            }
          } else {
            metadataProvider.addImageIdToUIDs(imageId, {
              StudyInstanceUID: studyInstanceUID,
              SeriesInstanceUID: seriesInstanceUID,
              SOPInstanceUID: instance.sopInstanceUID,
            });
          }
        }

        return synthesized;
      });

      // Filter out synthesized instances with invalid imageIds (not loadable by Cornerstone)
      const validSynthesizedInstances = synthesizedInstances.filter(inst => {
        const imageId = inst._imageId || inst.imageId;
        if (!imageId || typeof imageId !== 'string') {
          console.error('retrieveMadoMetadata: Instance missing or invalid imageId:', inst);
          return false;
        }
        const isValid = imageId.startsWith('wadors:') || imageId.startsWith('wadouri:');
        if (!isValid) {
          console.warn('retrieveMadoMetadata: Skipping instance with invalid imageId:', imageId);
        }
        return isValid;
      });

      // Store series summary metadata
      if (validSynthesizedInstances.length > 0) {
        if (!seriesSummaryMetadata[seriesInstanceUID]) {
          seriesSummaryMetadata[seriesInstanceUID] = synthesizeSeriesMetadata(displaySet);
        }

        // Store instances for this series
        if (!instancesPerSeries[seriesInstanceUID]) {
          instancesPerSeries[seriesInstanceUID] = [];
        }
        instancesPerSeries[seriesInstanceUID].push(...validSynthesizedInstances);
      }

      console.log(
        `✅ Synthesized ${validSynthesizedInstances.length} valid instances for series ${seriesInstanceUID.substring(0, 20)}...`
      );
    } catch (error) {
      console.error(`❌ Error synthesizing metadata for series ${seriesInstanceUID}:`, error);
      // Continue processing other series even if one fails
    }
  }

  // Add all metadata to the OHIF store
  const seriesMetadataArray = Object.values(seriesSummaryMetadata);
  if (seriesMetadataArray.length > 0) {
    DicomMetadataStore.addSeriesMetadata(seriesMetadataArray, madeInClient);

    Object.keys(instancesPerSeries).forEach(seriesInstanceUID => {
      // Deep clone to ensure all fields are preserved
      const instancesToStore = instancesPerSeries[seriesInstanceUID].map(inst => JSON.parse(JSON.stringify(inst)));
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[MADO] Storing instances in DicomMetadataStore:', instancesToStore);
      }
      DicomMetadataStore.addInstances(instancesToStore, madeInClient);
    });

    console.log(
      `🎉 MADO metadata synthesis complete: ${seriesMetadataArray.length} series, ${Object.values(instancesPerSeries).flat().length} total instances (ALL SYNTHESIZED - NO NETWORK CALLS)`
    );
  } else {
    console.warn('⚠️ No metadata was successfully synthesized from MADO manifest');
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


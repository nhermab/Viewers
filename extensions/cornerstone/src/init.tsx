import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import { init as cs3DInit, eventTarget, EVENTS, cache, imageLoadPoolManager, metaData } from '@cornerstonejs/core';

import initWADOImageLoader, { setPrefetchCache } from './initWADOImageLoader';
import initCornerstoneTools from './initCornerstoneTools';
import initStudyPrefetcherService from './initStudyPrefetcherService';

import { classes, DicomMetadataStore, utils } from '@ohif/core';

// Global cache for image pixel format information.
// Used by the metadata provider to return correct imagePixelModule values
// before the image is in cornerstone's cache.
const imagePixelFormatCache = new Map<
  string,
  {
    samplesPerPixel: number;
    photometricInterpretation: string;
    rows: number;
    columns: number;
    bitsAllocated: number;
    bitsStored: number;
    highBit: number;
  }
>();

export { imagePixelFormatCache };

// Expose for Cypress/debug (existing pattern in repo)
(window as any).cornerstone = cornerstone;
(window as any).cornerstoneTools = cornerstoneTools;

function _showCPURenderingModal(uiModalService: any, hangingProtocolService: any) {
  try {
    // Keep this minimal; some bundles may not include the full modal component.
    // This avoids runtime crashes while preserving the original intent.
    uiModalService?.show?.({
      title: 'CPU Rendering Enabled',
      content: 'CPU rendering is enabled. Performance may be reduced.',
      onClose: () => hangingProtocolService?.setProtocol?.(undefined),
    });
  } catch {
    // ignore
  }
}

// Use 'any' for the argument type to avoid TS errors for now
export default async function init({
  servicesManager,
  commandsManager,
  extensionManager,
  appConfig,
}: any): Promise<void> {
  (window as any).PUBLIC_LIB_URL = (window as any).PUBLIC_LIB_URL || './component/';

  const cs3DConfig: any = {
    peerImport: (appConfig as any).peerImport,
    debug: false,
    // Add any other required properties for Cornerstone3DConfig here if needed
  };
  // @ts-ignore
  await cs3DInit(cs3DConfig);

  cornerstone.setUseCPURendering(Boolean((appConfig as any).useCPURendering));

  cornerstone.setConfiguration({
    ...cornerstone.getConfiguration(),
    rendering: {
      ...cornerstone.getConfiguration().rendering,
      strictZSpacingForVolumeViewport: (appConfig as any).strictZSpacingForVolumeViewport,
    },
  });

  if ((appConfig as any).maxCacheSize) {
    cornerstone.cache.setMaxCacheSize((appConfig as any).maxCacheSize);
  }

  initCornerstoneTools();

  const { uiModalService, hangingProtocolService } = servicesManager.services;

  (window as any).services = servicesManager.services;
  (window as any).extensionManager = extensionManager;
  (window as any).commandsManager = commandsManager;

  if ((appConfig as any).showCPUFallbackMessage && cornerstone.getShouldUseCPURendering()) {
    _showCPURenderingModal(uiModalService, hangingProtocolService);
  }

  const metadataProvider = classes.MetadataProvider;

  // Register OHIF's metadataProvider with cornerstone's metaData system
  // This is critical for WADO image loader to access metadata
  metaData.addProvider((type, ...queries) => {
    try {
      // Validate imageId if present
      const imageId = queries[0];

      // Return undefined early for invalid imageIds - don't call metadataProvider.get at all
      // This prevents the "Empty imageId" error from being thrown
      if (imageId === undefined || imageId === null) {
        return undefined;
      }

      if (typeof imageId === 'string' && imageId.trim() === '') {
        return undefined;
      }

      // Fix spread argument error
      const result = metadataProvider.get.apply(metadataProvider, [type, ...queries]);

      // If querying imagePixelModule and we have an imageId, try to patch from cache immediately
      if (type === 'imagePixelModule' && typeof imageId === 'string' && imageId.length > 0) {
        const cachedImage = cache.getImage(imageId);
        if (cachedImage && !result?._patched) {
          // Image is in cache but metadata might not be patched yet
          patchMetadataFromCornerstone(imageId, cachedImage);
          // Query again to get updated metadata
          return metadataProvider.get(type, imageId);
        }
      }

      return result;
    } catch (error) {
      // Log the error but don't crash - return undefined to let other providers try
      if (error.message !== 'MetadataProvider::Empty imageId') {
        console.warn('Error in metadata provider:', error);
      }
      return undefined;
    }
  }, 9999); // High priority

  // Register the pixel format cache so MetadataProvider can use it as a fallback
  metadataProvider.setImagePixelFormatCache(imagePixelFormatCache);

  const patchMetadataFromCornerstone = (imageId: string, loadedImage?: any) => {
    try {
      const uids = metadataProvider.getUIDsFromImageID(imageId);
      if (!uids?.StudyInstanceUID || !uids?.SeriesInstanceUID || !uids?.SOPInstanceUID) {
        return;
      }

      const instance: any = DicomMetadataStore.getInstance(
        uids.StudyInstanceUID,
        uids.SeriesInstanceUID,
        uids.SOPInstanceUID
      );

      // Debug: log UIDs and instance before patching
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[MADO] patchMetadataFromCornerstone UIDs:', uids, 'Instance:', instance);
      }

      instance._patchedImageIds = instance._patchedImageIds || new Set<string>();
      const alreadyPatched = instance._patchedImageIds?.has?.(imageId);

      // Allow multiple attempts: progressive decode / multiframe can provide better pixel evidence later.
      if (alreadyPatched && instance._pixelModulePatched && instance._windowLevelPatched) {
        return;
      }

      // Prefer the event-provided image, then cache.
      const effectiveImage = loadedImage ;//|| cache.getImage(imageId);
      if (!effectiveImage) {
        return;
      }

      //TODO: debug logging
      console.log('🔍 Image loaded:', {
        imageId: imageId.substring(0, 100) + '...',
        width: effectiveImage.width,
        height: effectiveImage.height,
        rows: effectiveImage.rows,
        columns: effectiveImage.columns,
        samplesPerPixel: effectiveImage.samplesPerPixel,
        photometricInterpretation: effectiveImage.photometricInterpretation,
        color: effectiveImage.color,
        rgba: effectiveImage.rgba,
        instanceBefore: {
          SamplesPerPixel: instance.SamplesPerPixel,
          PhotometricInterpretation: instance.PhotometricInterpretation,
          NumberOfFrames: instance.NumberOfFrames,
          hasPerFrameFunctionalGroups: !!instance.PerFrameFunctionalGroupsSequence,
        },
      });

      // --- Rows/Cols ---
      const rows = effectiveImage.rows ?? effectiveImage.height;
      const cols = effectiveImage.columns ?? effectiveImage.width;
      if (rows) instance.Rows = rows;
      if (cols) instance.Columns = cols;

      // --- Geometry patching ---
      let geometryPatched = false;

      // For multiframe images, check if geometry is in PerFrameFunctionalGroupsSequence or SharedFunctionalGroupsSequence
      const isMultiframe = instance.NumberOfFrames > 1;
      if (isMultiframe) {
        // Check if we have functional group sequences with geometry
        const hasPerFrameGeometry = instance.PerFrameFunctionalGroupsSequence?.[0]?.PlanePositionSequence?.[0]?.ImagePositionPatient;
        const hasSharedOrientation = instance.SharedFunctionalGroupsSequence?.[0]?.PlaneOrientationSequence?.[0]?.ImageOrientationPatient;
        const hasSharedPixelMeasures = instance.SharedFunctionalGroupsSequence?.[0]?.PixelMeasuresSequence?.[0]?.PixelSpacing;

        if (hasPerFrameGeometry || hasSharedOrientation || hasSharedPixelMeasures) {
          console.log('✅ Multiframe DICOM has functional group geometry - marking as patched');
          instance._geometryPatched = true;
          geometryPatched = true;
        }
      }

      // Patch geometry fields from loaded image if available
      if (effectiveImage.imagePositionPatient) {
        instance.ImagePositionPatient = effectiveImage.imagePositionPatient;
      }
      if (effectiveImage.imageOrientationPatient) {
        instance.ImageOrientationPatient = effectiveImage.imageOrientationPatient;
      }
      if (effectiveImage.pixelSpacing) {
        instance.PixelSpacing = effectiveImage.pixelSpacing;
      }

      // Check if all required geometry fields are present and valid (for single-frame or if already extracted)
      if (!geometryPatched &&
        instance.Rows && instance.Columns &&
        Array.isArray(instance.ImagePositionPatient) && instance.ImagePositionPatient.length === 3 &&
        Array.isArray(instance.ImageOrientationPatient) && instance.ImageOrientationPatient.length === 6 &&
        Array.isArray(instance.PixelSpacing) && instance.PixelSpacing.length === 2
      ) {
        instance._geometryPatched = true;
        geometryPatched = true;
      }

      // Extra debug logging for geometry
      console.log('✅ Geometry patch:', {
        isMultiframe,
        Rows: instance.Rows,
        Columns: instance.Columns,
        ImagePositionPatient: instance.ImagePositionPatient,
        ImageOrientationPatient: instance.ImageOrientationPatient,
        PixelSpacing: instance.PixelSpacing,
        hasPerFrameGeometry: instance.PerFrameFunctionalGroupsSequence?.[0]?.PlanePositionSequence?.[0]?.ImagePositionPatient ? 'YES' : 'NO',
        _geometryPatched: geometryPatched
      });

      // --- VOI: for synthesized data, compute from pixel range if possible ---
      const isSynth = instance._isSynthesized || instance._synthesizedFromMado;
      if (!instance._windowLevelPatched) {
        const min = effectiveImage.minPixelValue;
        const max = effectiveImage.maxPixelValue;

        // Use DICOM-provided values for non-synth, otherwise compute.
        if (!isSynth && effectiveImage.windowCenter !== undefined && effectiveImage.windowWidth !== undefined) {
          const windowCenter = Array.isArray(effectiveImage.windowCenter)
            ? effectiveImage.windowCenter[0]
            : effectiveImage.windowCenter;
          const windowWidth = Array.isArray(effectiveImage.windowWidth)
            ? effectiveImage.windowWidth[0]
            : effectiveImage.windowWidth;

          if (windowCenter !== undefined && windowWidth !== undefined && windowWidth > 0) {
            instance.WindowCenter = windowCenter;
            instance.WindowWidth = windowWidth;
            instance._windowLevelPatched = true;
          }
        } else if (min !== undefined && max !== undefined) {
          const range = max - min;
          const ww = range > 0 ? range : 256;
          const wc = min + ww / 2;
          instance.WindowCenter = wc;
          instance.WindowWidth = ww;
          instance._windowLevelPatched = true;
        }
      }

      // --- Pixel module: always use DICOM metadata if present ---
      if (!instance._pixelModulePatched && rows && cols) {
        let samplesPerPixel = effectiveImage.samplesPerPixel;
        let photometricInterpretation = effectiveImage.photometricInterpretation;

        // Detect color from image properties
        const isColorImage = effectiveImage.color === true ||
                            effectiveImage.rgba === true ||
                            (effectiveImage.samplesPerPixel && effectiveImage.samplesPerPixel > 1);

        // If we detected color from the image loader
        if (isColorImage && !samplesPerPixel) {
          samplesPerPixel = 3;
        }
        if (isColorImage && !photometricInterpretation) {
          photometricInterpretation = 'RGB';
        }

        // If image loader didn't provide values, check what's already in the instance metadata
        // (this might be from actual DICOM metadata that was loaded before synthesis)
        if (samplesPerPixel === undefined || samplesPerPixel === null) {
          samplesPerPixel = instance.SamplesPerPixel || 1;
        }
        if (!photometricInterpretation) {
          photometricInterpretation = instance.PhotometricInterpretation || 'MONOCHROME2';
        }

        // Log what we're using
        console.log('📋 Pixel module values determined:', {
          samplesPerPixel,
          photometricInterpretation,
          sources: {
            effectiveImageSamplesPerPixel: effectiveImage.samplesPerPixel,
            effectiveImageColor: effectiveImage.color,
            effectiveImagePhotometric: effectiveImage.photometricInterpretation,
            instanceSamplesPerPixel: instance.SamplesPerPixel,
            instancePhotometric: instance.PhotometricInterpretation,
          }
        });

        // Always set the instance to the final values (DICOM preferred)
        // Preserve original DICOM pixel module values for debugging/auditing
        if (!instance._originalPixelModule) {
          instance._originalPixelModule = {
            SamplesPerPixel: instance.SamplesPerPixel,
            PhotometricInterpretation: instance.PhotometricInterpretation,
          };
        }

        // Decide whether to overwrite the original DICOM tags.
        // We should overwrite when the instance is synthesized (MADO) or when
        // the original tags are missing/undefined. For real DICOM instances, keep
        // the original tags intact and store effective/runtime values separately.
        const shouldOverwriteInstanceTags =
          !!instance._synthesizedFromMado || !!instance._isSynthesized ||
          !instance.SamplesPerPixel || !instance.PhotometricInterpretation;

        if (shouldOverwriteInstanceTags) {
          // Overwrite original tags so subsequent metadata consumers see the actual
          // pixel format (this is necessary when MADO provided synthetic metadata).
          instance.SamplesPerPixel = samplesPerPixel;
          instance.PhotometricInterpretation = photometricInterpretation;
          console.log('[MADO] Overwriting instance pixel module with effective image values for rendering', {
            sopInstanceUID: instance.SOPInstanceUID,
            overwrittenSamplesPerPixel: samplesPerPixel,
            overwrittenPhotometricInterpretation: photometricInterpretation,
          });
        } else {
          // Preserve original DICOM tags; expose the runtime/effective values on
          // the instance so renderers and consumers that need them can use them.
          instance._effectiveSamplesPerPixel = samplesPerPixel;
          instance._effectivePhotometricInterpretation = photometricInterpretation;
          console.log('[Cornerstone] Preserving original DICOM pixel module; storing effective values separately', {
            sopInstanceUID: instance.SOPInstanceUID,
            originalSamplesPerPixel: instance._originalPixelModule.SamplesPerPixel,
            originalPhotometricInterpretation: instance._originalPixelModule.PhotometricInterpretation,
            effectiveSamplesPerPixel: samplesPerPixel,
            effectivePhotometricInterpretation: photometricInterpretation,
          });
        }

        instance._pixelModulePatched = true;

        // Extra debug logging
        console.log('✅ Final pixel module values:', {
          SamplesPerPixel: samplesPerPixel,
          PhotometricInterpretation: photometricInterpretation,
          Source: {
            effectiveImageSamplesPerPixel: effectiveImage.samplesPerPixel,
            effectiveImagePhotometricInterpretation: effectiveImage.photometricInterpretation,
            instanceSamplesPerPixel: instance.SamplesPerPixel,
            instancePhotometricInterpretation: instance.PhotometricInterpretation,
          }
        });

        // Cache for future queries
        const pixelFormat = {
          samplesPerPixel,
          photometricInterpretation,
          rows,
          columns: cols,
          bitsAllocated: effectiveImage.bitsAllocated ?? effectiveImage.color ? 8 : 16,
          bitsStored: effectiveImage.bitsStored ?? effectiveImage.color ? 8 : 16,
          highBit: effectiveImage.highBit ?? effectiveImage.color ? 7 : 15,
        };
        imagePixelFormatCache.set(imageId, pixelFormat);

        console.log(
          `✅ Patched pixel format: ${samplesPerPixel} components, ${photometricInterpretation}`
        );
      }

      instance._patchedImageIds.add(imageId);
    } catch (error) {
      console.error('Error patching metadata from cornerstone:', error, { imageId });
    }
  };

  // Track which series have been re-evaluated for reconstructability
  const seriesReEvaluated = new Set<string>();

  const reEvaluateReconstructability = (seriesInstanceUID: string) => {
    if (seriesReEvaluated.has(seriesInstanceUID)) {
      return; // Already re-evaluated
    }

    try {
      const { displaySetService } = servicesManager.services;
      if (!displaySetService) {
        return;
      }

      // Find display sets for this series
      const displaySets = displaySetService.getDisplaySetsForSeries(seriesInstanceUID);
      if (!displaySets || displaySets.length === 0) {
        return;
      }

      // Get all instances for the series from the display set
      const instances = displaySets[0].images || [];
      if (!instances || instances.length === 0) {
        return;
      }

      // Check if geometry has been patched for at least some instances
      const patchedInstances = instances.filter(inst => inst._geometryPatched);
      if (patchedInstances.length === 0) {
        return; // No geometry patched yet
      }

      // Re-evaluate reconstructability using the patched metadata
      const { isDisplaySetReconstructable } = utils;
      if (!isDisplaySetReconstructable) {
        console.warn('isDisplaySetReconstructable not available');
        return;
      }

      const reconstructabilityInfo = isDisplaySetReconstructable(instances, appConfig);
      const newIsReconstructable = reconstructabilityInfo.value;

      console.log(`🔄 Re-evaluating reconstructability for series ${seriesInstanceUID}:`, {
        oldValue: displaySets[0].isReconstructable,
        newValue: newIsReconstructable,
        patchedInstances: patchedInstances.length,
        totalInstances: instances.length,
      });

      // Update all display sets for this series
      displaySets.forEach(ds => {
        if (ds.isReconstructable !== newIsReconstructable) {
          ds.isReconstructable = newIsReconstructable;
          ds.countIcon = newIsReconstructable ? 'icon-mpr' : undefined;

          // Clear the NOT_RECONSTRUCTABLE message if now reconstructable
          if (newIsReconstructable && ds.messages?.messages) {
            const NOT_RECONSTRUCTABLE_CODE = 3; // DisplaySetMessage.CODES.NOT_RECONSTRUCTABLE
            ds.messages.messages = ds.messages.messages.filter(msg => msg.id !== NOT_RECONSTRUCTABLE_CODE);
            console.log(`✅ Cleared NOT_RECONSTRUCTABLE message from display set ${ds.displaySetInstanceUID}`);
          }

          console.log(`✅ Updated display set ${ds.displaySetInstanceUID}: isReconstructable = ${newIsReconstructable}`);
        }
      });

      // Mark as re-evaluated
      seriesReEvaluated.add(seriesInstanceUID);

      // Notify the display set service of the update
      displaySetService.setDisplaySets(displaySetService.getActiveDisplaySets());
    } catch (error) {
      console.error('Error re-evaluating reconstructability:', error);
    }
  };

  const onImageLoaded = (evt: any) => {
    const detail = evt?.detail;
    const imageId = detail?.imageId ?? detail?.image?.imageId;
    if (!imageId) {
      return;
    }

    patchMetadataFromCornerstone(imageId, detail?.image);

    // After patching, check if we should re-evaluate reconstructability
    try {
      const uids = metadataProvider.getUIDsFromImageID(imageId);
      if (uids?.SeriesInstanceUID) {
        // Re-evaluate after a short delay to allow multiple images to load
        setTimeout(() => reEvaluateReconstructability(uids.SeriesInstanceUID), 500);
      }
    } catch (error) {
      // Ignore errors in re-evaluation
    }
  };

  eventTarget.removeEventListener?.(EVENTS.IMAGE_LOADED, onImageLoaded as any);
  eventTarget.addEventListener(EVENTS.IMAGE_LOADED, onImageLoaded as any);

  // Pass the authentication service, appConfig, and extensionManager so
  // initWADOImageLoader can access configuration like maxNumberOfWebWorkers.
  initWADOImageLoader(
    servicesManager.services.userAuthenticationService,
    appConfig,
    extensionManager
  );

  // Set up the prefetch cache for MADO workflows
  // The prefetch cache is populated by prefetchSeriesMetadata.ts when loading MADO manifests
  // This allows reusing prefetched images instead of fetching them again
  try {
    // Dynamically import to avoid circular dependencies
    import('@ohif/extension-default').then((defaultExtension) => {
      if (defaultExtension.getPrefetchedImage && defaultExtension.hasPrefetchedImage && defaultExtension.clearPrefetchedImage) {
        setPrefetchCache({
          getPrefetchedImage: defaultExtension.getPrefetchedImage,
          hasPrefetchedImage: defaultExtension.hasPrefetchedImage,
          clearPrefetchedImage: defaultExtension.clearPrefetchedImage,
        });
        console.log('[Cornerstone Init] Prefetch cache connected to MADO prefetch system');
      }
    }).catch((err) => {
      console.warn('[Cornerstone Init] Could not set up prefetch cache:', err);
    });
  } catch (err) {
    console.warn('[Cornerstone Init] Error setting up prefetch cache:', err);
  }

  // Ensure StudyPrefetcherService is initialized with event manager
  initStudyPrefetcherService(servicesManager);

  if ((appConfig as any).enableDevTools) {
    (window as any).cs3D = {
      cornerstone,
      cornerstoneTools,
      cache,
      imageLoadPoolManager,
      eventTarget,
      EVENTS,
      classes,
      DicomMetadataStore,
      patchMetadataFromCornerstone,
    };
  }

  if ((appConfig as any).prefetchStudy?.studyInstanceUID) {
    // Keep existing behavior; service init happens elsewhere.
    // This block intentionally does not enable heavy prefetch by default.
    // console.debug('Prefetch study enabled:', appConfig.prefetchStudy.studyInstanceUID);
  }
}

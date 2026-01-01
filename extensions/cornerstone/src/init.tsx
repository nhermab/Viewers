import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import { init as cs3DInit, eventTarget, EVENTS, cache, imageLoadPoolManager, metaData } from '@cornerstonejs/core';

import initWADOImageLoader from './initWADOImageLoader';
import initCornerstoneTools from './initCornerstoneTools';
import initStudyPrefetcherService from './initStudyPrefetcherService';

import { classes, DicomMetadataStore } from '@ohif/core';

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

      console.log('🔍 Image loaded:', {
        imageId: imageId.substring(0, 100) + '...',
        width: effectiveImage.width,
        height: effectiveImage.height,
        rows: effectiveImage.rows,
        columns: effectiveImage.columns,
        samplesPerPixel: effectiveImage.samplesPerPixel,
        photometricInterpretation: effectiveImage.photometricInterpretation,
        instanceBefore: {
          SamplesPerPixel: instance.SamplesPerPixel,
          PhotometricInterpretation: instance.PhotometricInterpretation,
        },
      });

      // --- Rows/Cols ---
      const rows = effectiveImage.rows ?? effectiveImage.height;
      const cols = effectiveImage.columns ?? effectiveImage.width;
      if (rows) instance.Rows = rows;
      if (cols) instance.Columns = cols;

      // --- VOI: for synthesized data, compute from pixel range if possible ---
      const isSynth = instance._isSynthesized || instance._synthesizedFromMado;
      if (!instance._windowLevelPatched) {
        const min = effectiveImage.minPixelValue;
        const max = effectiveImage.maxPixelValue;

        // Use DICOM-provided values for non-synth, otherwise compute.
        if (!isSynth && effectiveImage.windowCenter !== undefined && effectiveImage.windowWidth !== undefined) {
          const wc = Array.isArray(effectiveImage.windowCenter)
            ? effectiveImage.windowCenter[0]
            : effectiveImage.windowCenter;
          const ww = Array.isArray(effectiveImage.windowWidth)
            ? effectiveImage.windowWidth[0]
            : effectiveImage.windowWidth;

          if (wc !== undefined && ww !== undefined && ww > 0) {
            instance.WindowCenter = wc;
            instance.WindowWidth = ww;
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
        let samplesPerPixel = instance.SamplesPerPixel;
        let photometricInterpretation = instance.PhotometricInterpretation;

        // If the instance is synthesized, always overwrite with loaded image values if available
        if (instance._isSynthesized || instance._synthesizedFromMado) {
          if (effectiveImage.samplesPerPixel !== undefined) {
            samplesPerPixel = effectiveImage.samplesPerPixel;
            console.log('📋 Overwriting synthesized SamplesPerPixel with loaded image:', samplesPerPixel);
          }
          if (effectiveImage.photometricInterpretation) {
            photometricInterpretation = effectiveImage.photometricInterpretation;
            console.log('📋 Overwriting synthesized PhotometricInterpretation with loaded image:', photometricInterpretation);
          }
        }

        // Always set the instance to the final values (DICOM preferred)
        instance.SamplesPerPixel = samplesPerPixel;
        instance.PhotometricInterpretation = photometricInterpretation;
        instance._pixelModulePatched = true;

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

  const onImageLoaded = (evt: any) => {
    const detail = evt?.detail;
    const imageId = detail?.imageId ?? detail?.image?.imageId;
    if (!imageId) {
      return;
    }

    patchMetadataFromCornerstone(imageId, detail?.image);
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

import { volumeLoader } from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { errorHandler, utils } from '@ohif/core';

// Use require for compatibility
const { registerVolumeLoader } = volumeLoader;

export default function initWADOImageLoader(
  userAuthenticationService,
  appConfig,
  extensionManager
) {
  // Defensive defaults: callers in the wild may pass an empty object or omit args.
  appConfig = appConfig || {};
  userAuthenticationService = userAuthenticationService || {};
  extensionManager = extensionManager || {};

  registerVolumeLoader('cornerstoneStreamingImageVolume', cornerstoneStreamingImageVolumeLoader);

  registerVolumeLoader(
    'cornerstoneStreamingDynamicImageVolume',
    cornerstoneStreamingDynamicImageVolumeLoader
  );

  dicomImageLoader.init({
    maxWebWorkers: Math.min(
      Math.max(navigator.hardwareConcurrency - 1, 1),
      // Respect configured maxNumberOfWebWorkers when provided, otherwise use a very large cap.
      typeof appConfig.maxNumberOfWebWorkers === 'number'
        ? appConfig.maxNumberOfWebWorkers
        : Number.POSITIVE_INFINITY
    ),
    beforeSend: function (xhr) {
      //TODO should be removed in the future and request emitted by DicomWebDataSource
      const sourceConfig = extensionManager.getActiveDataSource?.()?.[0]?.getConfig?.() ?? {};
      const headers = userAuthenticationService.getAuthorizationHeader?.() ?? {};
      const acceptHeader = utils.generateAcceptHeader(
        sourceConfig.acceptHeader,
        sourceConfig.requestTransferSyntaxUID,
        sourceConfig.omitQuotationForMultipartRequest
      );

      const xhrRequestHeaders = {
        Accept: acceptHeader,
      };

      if (headers) {
        Object.assign(xhrRequestHeaders, headers);
      }

      return xhrRequestHeaders;
    },
    errorInterceptor: error => {
      errorHandler.getHTTPErrorHandler(error);
    },
  });

  // Add debug logging for image load
  const oldImageLoader = dicomImageLoader.wadouri.loadImage;
  dicomImageLoader.wadouri.loadImage = function (imageId, options) {
    return oldImageLoader.call(this, imageId, options).then(image => {
      // Print transfer syntax, photometric interpretation, samples per pixel
      try {
        const meta = dicomImageLoader.wadouri.metaDataManager.get(imageId);
        if (meta) {
          console.log('[WADOImageLoader] Loaded image:', {
            imageId,
            transferSyntax: meta.transferSyntax,
            photometricInterpretation: meta.photometricInterpretation,
            samplesPerPixel: meta.samplesPerPixel,
          });
        }
      } catch (e) {
        console.warn('[WADOImageLoader] Could not log image metadata:', e);
      }
      return image;
    });
  };

  // Add debug logging for WADO-RS image load
  if (dicomImageLoader && dicomImageLoader.wadors && dicomImageLoader.wadors.loadImage) {
    const oldWadorsImageLoader = dicomImageLoader.wadors.loadImage;
    dicomImageLoader.wadors.loadImage = function (imageId, options) {
      return oldWadorsImageLoader.call(this, imageId, options).then(image => {
        try {
          // Try to get metadata from the image or from the loader's metaDataManager
          let meta = null;
          if (image && image.data && image.data.string) {
            // Try to extract DICOM tags directly
            meta = {
              transferSyntax: image.data.string('x00020010'),
              photometricInterpretation: image.data.string('x00280004'),
              samplesPerPixel: image.data.uint16('x00280002'),
            };
          } else if (dicomImageLoader.wadors.metaDataManager) {
            meta = dicomImageLoader.wadors.metaDataManager.get(imageId);
          }
          if (meta) {
            console.log('[WADO-RS Loader] Loaded image:', {
              imageId,
              transferSyntax: meta.transferSyntax,
              photometricInterpretation: meta.photometricInterpretation,
              samplesPerPixel: meta.samplesPerPixel,
            });
          }
        } catch (e) {
          console.warn('[WADO-RS Loader] Could not log image metadata:', e);
        }
        return image;
      });
    };
  }
}

export function destroy() {
  console.debug('Destroying WADO Image Loader');
}

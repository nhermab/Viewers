/**
 * Type declarations for initWADOImageLoader.js
 */

export interface PrefetchCacheModule {
  getPrefetchedImage: (imageId: string) => ArrayBuffer | undefined;
  hasPrefetchedImage: (imageId: string) => boolean;
  clearPrefetchedImage: (imageId: string) => void;
}

/**
 * Set the prefetch cache module. Called by MADO integration.
 */
export function setPrefetchCache(cacheModule: PrefetchCacheModule): void;

/**
 * Initialize the WADO image loader with authentication and configuration.
 */
export default function initWADOImageLoader(
  userAuthenticationService: any,
  appConfig: any,
  extensionManager: any
): void;

/**
 * Destroy the WADO image loader.
 */
export function destroy(): void;


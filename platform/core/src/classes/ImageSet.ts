import { Types as csTypes } from '@cornerstonejs/core';
import guid from '../utils/guid.js';
import {
  instancesSortCriteria,
  isValidForPositionSort,
  sortImagesByPatientPosition,
} from '../utils/sortStudy';

type Attributes = Record<string, unknown>;
export type Image = {
  StudyInstanceUID?: string;
  ImagePositionPatient?: csTypes.Point3;
  ImageOrientationPatient?: csTypes.Point3;
};

/**
 * This class defines an ImageSet object which will be used across the viewer. This object represents
 * a list of images that are associated by any arbitrary criteria being thus content agnostic. Besides the
 * main attributes (images and uid) it allows additional attributes to be appended to it (currently
 * indiscriminately, but this should be changed).
 */
class ImageSet {
  images: Image[];
  uid: string;
  instances: Image[];
  instance?: Image;
  StudyInstanceUID?: string;
  isReconstructable?: boolean;

  constructor(images: Image[]) {
    if (!Array.isArray(images)) {
      throw new Error('ImageSet expects an array of images');
    }

    // Sort images by InstanceNumber immediately to ensure correct order
    // This is critical for MADO workflows and any case where position data is unavailable
    const sortedImages = [...images].sort((a, b) => {
      const aNum = parseInt((a as Record<string, unknown>).InstanceNumber as string) || 0;
      const bNum = parseInt((b as Record<string, unknown>).InstanceNumber as string) || 0;
      if (aNum !== bNum) {
        return aNum - bNum;
      }
      // Fallback to SOPInstanceUID
      const aUID = ((a as Record<string, unknown>).SOPInstanceUID as string) || '';
      const bUID = ((b as Record<string, unknown>).SOPInstanceUID as string) || '';
      return aUID.localeCompare(bUID);
    });

    // @property "images"
    Object.defineProperty(this, 'images', {
      enumerable: false,
      configurable: false,
      writable: false,
      value: sortedImages,
    });

    // @property "uid"
    Object.defineProperty(this, 'uid', {
      enumerable: false,
      configurable: false,
      writable: false,
      value: guid(), // Unique ID of the instance
    });

    this.instances = sortedImages;
    this.instance = sortedImages[0];
    this.StudyInstanceUID = this.instance?.StudyInstanceUID;
  }

  load: () => Promise<void>;

  getUID(): string {
    return this.uid;
  }

  setAttribute(attribute: string, value: unknown): void {
    this[attribute] = value;
  }

  getAttribute(attribute: string): unknown {
    return this[attribute];
  }

  setAttributes(attributes: Attributes): void {
    if (typeof attributes === 'object' && attributes !== null) {
      for (const [attribute, value] of Object.entries(attributes)) {
        this[attribute] = value;
      }
    }
  }

  getNumImages = (): number => this.images.length;

  getImage(index: number): Image {
    return this.images[index];
  }

  /**
   * Default image sorting. Sorts by the following (in order of priority)
   * 1. Image position (if ImagePositionPatient and ImageOrientationPatient are defined)
   * 2. Sort by a provided sortingCallback Criteria
   * Note: Images are sorted in-place and a reference to the sorted image array is returned.
   *
   * @returns images - reference to images after sorting
   */
  sort(customizationService): Image[] {
    // Check instanceSort customization
    const customizedSortingCriteria =
      customizationService.getCustomization('instanceSortingCriteria');
    const combinedSortFunctions = Object.assign(
      {},
      instancesSortCriteria,
      customizedSortingCriteria?.sortFunctions || {}
    );
    const userSpecifiedCriteria = customizedSortingCriteria?.defaultSortFunctionName;

    // Prefer customized sort function when available
    if (
      userSpecifiedCriteria &&
      typeof combinedSortFunctions[userSpecifiedCriteria] === 'function'
    ) {
      return this.images.sort(combinedSortFunctions[userSpecifiedCriteria]);
    }

    // Check if position-based sorting is possible
    if (this.isReconstructable && isValidForPositionSort(this.images)) {
      return sortImagesByPatientPosition(this.images);
    }

    // Default: sort by InstanceNumber (critical for MADO workflows)
    return this.images.sort(instancesSortCriteria.sortByInstanceNumber);
  }

  /**
   * Sort using the provided callback function.
   * Note: Images are sorted in-place and a reference to the sorted image array is returned.
   *
   * @param sortingCallback - sorting function
   * @returns images - reference to images after sorting
   */
  sortBy(sortingCallback: (a: Image, b: Image) => number): Image[] {
    return this.images.sort(sortingCallback);
  }
}

export default ImageSet;

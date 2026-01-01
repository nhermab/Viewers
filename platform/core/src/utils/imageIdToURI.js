/**
 * Removes the data loader scheme from the imageId
 *
 * @param {string} imageId Image ID
 * @returns {string} imageId without the data loader scheme
 * @memberof Cache
 */
export default function imageIdToURI(imageId) {
  if (typeof imageId !== 'string') {
    console.warn('imageIdToURI: imageId is not a string', imageId);
    return '';
  }
  const colonIndex = imageId.indexOf(':');

  return imageId.substring(colonIndex + 1);
}

function buildInstanceWadoRsUri(instance, config) {
  // Accept common UID property name variants
  const StudyInstanceUID = instance.StudyInstanceUID || instance.studyInstanceUID || instance.StudyInstanceUid || instance.StudyInstanceUid;
  const SeriesInstanceUID = instance.SeriesInstanceUID || instance.seriesInstanceUID || instance.SeriesInstanceUid || instance.SeriesInstanceUid;
  const SOPInstanceUID = instance.SOPInstanceUID || instance.sopInstanceUID || instance.SOPInstanceUid || instance.SOPInstanceUid;

  // Ensure base has no trailing slash
  let base = config.wadoRoot || '';
  base = base.replace(/\/+$/, '');

  // If any UID or base is missing, bail out to avoid creating malformed URLs
  if (!base || !StudyInstanceUID || !SeriesInstanceUID || !SOPInstanceUID) {
    return null;
  }

  return `${base}/studies/${StudyInstanceUID}/series/${SeriesInstanceUID}/instances/${SOPInstanceUID}`;
}

function buildInstanceFrameWadoRsUri(instance, config, frame) {
  const baseWadoRsUri = buildInstanceWadoRsUri(instance, config);

  frame = frame || 1;

  return `${baseWadoRsUri}/frames/${frame}`;
}

// function getWADORSImageUrl(instance, frame) {
//   const wadorsuri = buildInstanceFrameWadoRsUri(instance, config, frame);

//   if (!wadorsuri) {
//     return;
//   }

//   // Use null to obtain an imageId which represents the instance
//   if (frame === null) {
//     wadorsuri = wadorsuri.replace(/frames\/(\d+)/, '');
//   } else {
//     // We need to sum 1 because WADO-RS frame number is 1-based
//     frame = frame ? parseInt(frame) + 1 : 1;

//     // Replaces /frame/1 by /frame/{frame}
//     wadorsuri = wadorsuri.replace(/frames\/(\d+)/, `frames/${frame}`);
//   }

//   return wadorsuri;
// }

/**
 * Obtain an imageId for Cornerstone based on the WADO-RS scheme
 *
 * @param {object} instanceMetada metadata object (InstanceMetadata)
 * @param {(string\|number)} [frame] the frame number
 * @returns {string} The imageId to be used by Cornerstone
 */
export default function getWADORSImageId(instance, config, frame) {
  //const uri = getWADORSImageUrl(instance, frame);
  const uri = buildInstanceFrameWadoRsUri(instance, config, frame);

  if (!uri) {
    return;
  }

  return `wadors:${uri}`;
}

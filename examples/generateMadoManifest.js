/**
 * MADO Manifest Generator Example
 *
 * This script demonstrates how to create a MADO manifest file programmatically
 * using dcmjs. This is useful for testing the MADO loader or generating manifests
 * from existing study data.
 *
 * Usage:
 *   node generateMadoManifest.js > manifest.dcm
 *
 * Or import and use in your application:
 *   import { generateMadoManifest } from './generateMadoManifest';
 */

import dcmjs from 'dcmjs';
import fs from 'fs';

const { DicomDict, DicomMessage } = dcmjs.data;

/**
 * Generate a MADO manifest from study metadata
 *
 * @param {Object} studyData - Study information
 * @param {string} studyData.studyInstanceUID - Study Instance UID
 * @param {string} studyData.patientName - Patient name (e.g., "DOE^JOHN")
 * @param {string} studyData.patientID - Patient ID
 * @param {Array} studyData.series - Array of series objects
 * @returns {ArrayBuffer} DICOM P10 file buffer
 */
export function generateMadoManifest(studyData) {
  const {
    studyInstanceUID,
    patientName = 'ANONYMOUS^PATIENT',
    patientID = 'UNKNOWN',
    studyDate,
    series = [],
  } = studyData;

  // Create the dataset
  const dataset = {
    // SOP Common Module
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.59', // Key Object Selection Document
    SOPInstanceUID: generateUID(),

    // Patient Module
    PatientName: patientName,
    PatientID: patientID,

    // Study Module
    StudyInstanceUID: studyInstanceUID,
    StudyDate: studyDate || getTodayDate(),
    StudyTime: getCurrentTime(),

    // Key Object Document Module
    ContentDate: getTodayDate(),
    ContentTime: getCurrentTime(),

    // Evidence Sequence - THE CORE OF MADO
    CurrentRequestedProcedureEvidenceSequence: series.map(seriesData => ({
      // Study-level reference
      StudyInstanceUID: studyInstanceUID,

      // Series-level references
      ReferencedSeriesSequence: [{
        SeriesInstanceUID: seriesData.seriesInstanceUID,
        SeriesDescription: seriesData.seriesDescription || 'Series',

        // Optional: RetrieveURL for dynamic WADO-RS endpoint
        ...(seriesData.retrieveURL && { RetrieveURL: seriesData.retrieveURL }),

        // Instance-level references
        ReferencedSOPSequence: seriesData.instances.map(instance => ({
          ReferencedSOPClassUID: instance.sopClassUID,
          ReferencedSOPInstanceUID: instance.sopInstanceUID,
          ...(instance.instanceNumber && { InstanceNumber: instance.instanceNumber }),
        })),
      }],
    })),
  };

  // Denaturalize (convert to DICOM format)
  const denaturalized = DicomDict.denaturalize(dataset);

  // Write to buffer
  const buffer = denaturalized.write();

  return buffer;
}

/**
 * Helper function to generate a DICOM UID
 */
function generateUID() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  return `2.25.${timestamp}${random}`;
}

/**
 * Get today's date in DICOM format (YYYYMMDD)
 */
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Get current time in DICOM format (HHMMSS.FFFFFF)
 */
function getCurrentTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${hours}${minutes}${seconds}`;
}

/**
 * Example usage
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  // Example study data
  const exampleStudy = {
    studyInstanceUID: '1.2.840.113619.2.5.1762583153.215519.978957063.78',
    patientName: 'DOE^JOHN',
    patientID: '12345',
    studyDate: '20240101',
    series: [
      {
        seriesInstanceUID: '1.2.840.113619.2.5.1762583153.215519.978957063.79',
        seriesDescription: 'CT Chest',
        retrieveURL: 'http://172.20.240.184:8042/dicom-web',
        instances: [
          {
            sopClassUID: '1.2.840.10008.5.1.4.1.1.2', // CT Image Storage
            sopInstanceUID: '1.2.840.113619.2.5.1762583153.215519.978957063.80',
            instanceNumber: 1,
          },
          {
            sopClassUID: '1.2.840.10008.5.1.4.1.1.2',
            sopInstanceUID: '1.2.840.113619.2.5.1762583153.215519.978957063.81',
            instanceNumber: 2,
          },
          // Add more instances...
        ],
      },
      {
        seriesInstanceUID: '1.2.840.113619.2.5.1762583153.215519.978957063.90',
        seriesDescription: 'CT Abdomen',
        retrieveURL: 'http://172.20.240.184:8042/dicom-web',
        instances: [
          {
            sopClassUID: '1.2.840.10008.5.1.4.1.1.2',
            sopInstanceUID: '1.2.840.113619.2.5.1762583153.215519.978957063.91',
            instanceNumber: 1,
          },
          // Add more instances...
        ],
      },
    ],
  };

  // Generate manifest
  const manifestBuffer = generateMadoManifest(exampleStudy);

  // Write to file
  fs.writeFileSync('manifest.dcm', Buffer.from(manifestBuffer));

  console.log('✅ MADO manifest generated: manifest.dcm');
  console.log('📊 Study UID:', exampleStudy.studyInstanceUID);
  console.log('📦 Series count:', exampleStudy.series.length);
  console.log('🔗 Test URL: http://localhost:3000/mado?manifestUrl=http://your-server/manifest.dcm');
}

/**
 * Alternative: Create manifest from server query
 */
export async function generateMadoFromServer(wadoRsUrl, studyInstanceUID) {
  try {
    // Query study metadata
    const studyUrl = `${wadoRsUrl}/studies/${studyInstanceUID}/metadata`;
    const response = await fetch(studyUrl, {
      headers: { 'Accept': 'application/dicom+json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch study metadata: ${response.statusText}`);
    }

    const metadata = await response.json();

    // Group by series
    const seriesMap = new Map();

    metadata.forEach(instance => {
      const seriesUID = instance['0020000E']?.Value?.[0];
      if (!seriesUID) return;

      if (!seriesMap.has(seriesUID)) {
        seriesMap.set(seriesUID, {
          seriesInstanceUID: seriesUID,
          seriesDescription: instance['0008103E']?.Value?.[0] || 'Unknown',
          retrieveURL: wadoRsUrl,
          instances: [],
        });
      }

      seriesMap.get(seriesUID).instances.push({
        sopClassUID: instance['00080016']?.Value?.[0],
        sopInstanceUID: instance['00080018']?.Value?.[0],
        instanceNumber: instance['00200013']?.Value?.[0],
      });
    });

    // Create study data
    const firstInstance = metadata[0];
    const studyData = {
      studyInstanceUID,
      patientName: firstInstance['00100010']?.Value?.[0]?.Alphabetic || 'ANONYMOUS',
      patientID: firstInstance['00100020']?.Value?.[0] || 'UNKNOWN',
      studyDate: firstInstance['00080020']?.Value?.[0],
      series: Array.from(seriesMap.values()),
    };

    // Generate manifest
    return generateMadoManifest(studyData);
  } catch (error) {
    console.error('Error generating MADO from server:', error);
    throw error;
  }
}

/**
 * Python equivalent example
 *
 * ```python
 * from pydicom.dataset import Dataset, FileDataset
 * from pydicom.sequence import Sequence
 * import pydicom
 *
 * def generate_mado_manifest(study_data):
 *     # Create dataset
 *     ds = FileDataset("manifest.dcm", {}, file_meta=file_meta, preamble=b"\0" * 128)
 *
 *     # Patient module
 *     ds.PatientName = study_data['patient_name']
 *     ds.PatientID = study_data['patient_id']
 *
 *     # Study module
 *     ds.StudyInstanceUID = study_data['study_uid']
 *     ds.StudyDate = study_data['study_date']
 *
 *     # Evidence sequence
 *     evidence_seq = Sequence()
 *     study_item = Dataset()
 *
 *     series_seq = Sequence()
 *     for series_data in study_data['series']:
 *         series_item = Dataset()
 *         series_item.SeriesInstanceUID = series_data['series_uid']
 *         series_item.SeriesDescription = series_data['description']
 *
 *         sop_seq = Sequence()
 *         for instance in series_data['instances']:
 *             sop_item = Dataset()
 *             sop_item.ReferencedSOPClassUID = instance['class_uid']
 *             sop_item.ReferencedSOPInstanceUID = instance['instance_uid']
 *             sop_seq.append(sop_item)
 *
 *         series_item.ReferencedSOPSequence = sop_seq
 *         series_seq.append(series_item)
 *
 *     study_item.ReferencedSeriesSequence = series_seq
 *     evidence_seq.append(study_item)
 *     ds.CurrentRequestedProcedureEvidenceSequence = evidence_seq
 *
 *     # Save
 *     ds.save_as("manifest.dcm")
 * ```
 */

export default generateMadoManifest;


import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PropTypes from 'prop-types';
import { DicomMetadataStore } from '@ohif/core';

/**
 * MadoViewer Component
 *
 * Handles the MADO manifest-driven loading workflow:
 * 1. Extracts manifestUrl from query parameters
 * 2. Loads the MADO manifest via the data source
 * 3. Redirects to the viewer with the loaded study
 *
 * Route: /mado?manifestUrl=<url>
 */
const MadoViewer = ({ extensionManager }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMadoManifest = async () => {
      try {
        // Get the manifest URL from query parameters
        const manifestUrl = searchParams.get('manifestUrl') || searchParams.get('madoUrl');

        if (!manifestUrl) {
          throw new Error('Missing required parameter: manifestUrl or madoUrl must be provided');
        }

        console.log('MADO Viewer: Loading manifest from', manifestUrl);

        // Get the active data source
        const dataSourceName = searchParams.get('dataSource') || 'dicomweb';
        const dataSources = extensionManager.getActiveDataSource();

        if (!dataSources || dataSources.length === 0) {
          throw new Error('No active data source found');
        }

        // Find the specified data source or use the first one
        let dataSource = dataSources[0];
        if (dataSourceName) {
          const found = dataSources.find(ds => ds.sourceName === dataSourceName);
          if (found) {
            dataSource = found;
          }
        }

        // Check if the data source supports MADO
        if (!dataSource.retrieve?.series?.madoMetadata) {
          throw new Error(
            'The active data source does not support MADO manifest loading. Ensure you are using the DicomWebDataSource with MADO support enabled.'
          );
        }

        // Load the manifest and metadata
        console.log('MADO Viewer: Calling madoMetadata...');
        await dataSource.retrieve.series.madoMetadata({
          manifestUrl,
          madeInClient: false,
        });

        console.log('MADO Viewer: Metadata loaded successfully');

        // Get the loaded study UID from the metadata store
        const studies = DicomMetadataStore.getStudyInstanceUIDs();

        if (!studies || studies.length === 0) {
          throw new Error('No study data was loaded from the MADO manifest');
        }

        const studyInstanceUID = studies[0];
        console.log('MADO Viewer: Navigating to study', studyInstanceUID);

        // Navigate to the viewer with the loaded study
        const viewerPath = `/viewer?StudyInstanceUIDs=${studyInstanceUID}`;
        navigate(viewerPath, { replace: true });
      } catch (err: unknown) {
        console.error('MADO Viewer: Error loading manifest', err);
        const message = err instanceof Error ? err.message : 'Failed to load MADO manifest';
        setError(message);
      }
    };

    loadMadoManifest();
  }, [searchParams, navigate, extensionManager]);

  if (error) {
    return (
      <div className="absolute flex h-full w-full items-center justify-center text-white">
        <div className="text-center">
          <h2 className="mb-4 text-2xl font-bold">MADO Loading Error</h2>
          <p className="mb-4 text-red-400">{error}</p>
          <button
            className="bg-primary-light hover:bg-primary-main rounded px-6 py-2"
            onClick={() => navigate('/')}
          >
            Return to Study List
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute flex h-full w-full items-center justify-center text-white">
      <div className="text-center">
        <div className="mb-4">
          <div className="border-primary-light inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-r-transparent" />
        </div>
        <h3 className="text-xl">Loading MADO Manifest...</h3>
        <p className="mt-2 text-gray-400">Retrieving study metadata from manifest</p>
      </div>
    </div>
  );
};

MadoViewer.propTypes = {
  extensionManager: PropTypes.object.isRequired,
};

export default MadoViewer;

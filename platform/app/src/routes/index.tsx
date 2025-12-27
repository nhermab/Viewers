import React, { useEffect } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '@ohif/ui-next';

// Route Components
import Local from './Local';
import Debug from './Debug';
import NotFound from './NotFound';
import MadoViewer from './MadoViewer';
import buildModeRoutes from './buildModeRoutes';
import PrivateRoute from './PrivateRoute';
import PropTypes from 'prop-types';
import { routerBasename } from '../utils/publicUrl';
import { useAppConfig } from '@state';
import { history } from '../utils/history';

interface RouteConfig {
  path: string;
  children: React.ComponentType<unknown>;
  private?: boolean;
  props?: Record<string, unknown>;
}

interface CustomRoutes {
  routes?: RouteConfig[];
  notFoundRoute?: RouteConfig;
}

const NotFoundServer = ({
  message = 'Unable to query for studies at this time. Check your data source configuration or network connection',
}) => {
  return (
    <div className="absolute flex h-full w-full items-center justify-center text-white">
      <div>
        <h4>{message}</h4>
      </div>
    </div>
  );
};

NotFoundServer.propTypes = {
  message: PropTypes.string,
};

const NotFoundStudy = () => {
  const [appConfig] = useAppConfig();
  const { showStudyList } = appConfig;

  return (
    <div className="absolute flex h-full w-full items-center justify-center text-white">
      <div>
        <h4>One or more of the requested studies are not available at this time.</h4>
        {showStudyList && (
          <p className="mt-2">
            {'Return to the '}
            <Link
              className="text-primary-light"
              to="/"
            >
              study list
            </Link>
            {' to select a different study to view.'}
          </p>
        )}
      </div>
    </div>
  );
};

NotFoundStudy.propTypes = {
  message: PropTypes.string,
};

// TODO: Include "routes" debug route if dev build
const bakedInRoutes: RouteConfig[] = [
  {
    path: `/mado`,
    children: MadoViewer,
    private: true,
  },
  {
    path: `/notfoundserver`,
    children: NotFoundServer,
  },
  {
    path: `/notfoundstudy`,
    children: NotFoundStudy,
  },
  {
    path: `/debug`,
    children: Debug,
  },
  {
    path: `/local`,
    children: Local.bind(null, { modePath: '' }), // navigate to the worklist
  },
  {
    path: `/localbasic`,
    children: Local.bind(null, { modePath: 'viewer/dicomlocal' }),
  },
];

// NOT FOUND (404)
const notFoundRoute = { path: '*', children: NotFound };

const DEFAULT_MADO_MANIFEST_URL =
  'https://ihe.tldr.me/MADO_FROM_SCU/mado_1.3.6.1.4.1.14519.5.2.1.7310.5101.860473186348887719777907797922.dcm';

function HomeRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(`/mado?manifestUrl=${encodeURIComponent(DEFAULT_MADO_MANIFEST_URL)}`);
  }, [navigate]);

  return null;
}

const createRoutes = ({
  modes,
  dataSources,
  extensionManager,
  servicesManager,
  commandsManager,
  hotkeysManager,
}: withAppTypes) => {
  const routes =
    buildModeRoutes({
      modes,
      dataSources,
      extensionManager,
      servicesManager,
      commandsManager,
      hotkeysManager,
    }) || [];

  const { customizationService } = servicesManager.services;

  const path =
    routerBasename.length > 1 && routerBasename.endsWith('/')
      ? routerBasename.substring(0, routerBasename.length - 1)
      : routerBasename;

  console.log('Registering worklist route', routerBasename, path);

  const WorkListRoute: RouteConfig = {
    path: '/',
    children: HomeRedirect,
    private: true,
  };

  const customRoutes = customizationService.getCustomization('routes.customRoutes') as
    | CustomRoutes
    | undefined;

  const allRoutes = [
    ...routes,
    WorkListRoute,
    ...(customRoutes?.routes || []),
    ...bakedInRoutes,
    customRoutes?.notFoundRoute || notFoundRoute,
  ];

  function RouteWithErrorBoundary({ route }: { route: RouteConfig }) {
    const [appConfig] = useAppConfig();
    const { showErrorDetails } = appConfig;

    history.navigate = useNavigate();

    return (
      <ErrorBoundary
        context={`Route ${route.path}`}
        showErrorDetails={showErrorDetails}
      >
        <route.children
          {...route.props}
          servicesManager={servicesManager}
          extensionManager={extensionManager}
          hotkeysManager={hotkeysManager}
        />
      </ErrorBoundary>
    );
  }

  const { userAuthenticationService } = servicesManager.services;

  // All routes are private by default and then we let the user auth service
  // to check if it is enabled or not
  // Todo: I think we can remove the second public return below
  return (
    <Routes>
      {allRoutes.map((route, i) => {
        return route.private === true ? (
          <Route
            key={i}
            path={route.path}
            element={
              <PrivateRoute
                handleUnauthenticated={() => userAuthenticationService.handleUnauthenticated()}
              >
                <RouteWithErrorBoundary route={route} />
              </PrivateRoute>
            }
          ></Route>
        ) : (
          <Route
            key={i}
            path={route.path}
            element={<RouteWithErrorBoundary route={route} />}
          />
        );
      })}
    </Routes>
  );
};

export default createRoutes;

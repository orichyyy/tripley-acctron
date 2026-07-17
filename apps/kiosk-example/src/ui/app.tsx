import { useEffect } from "react";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";

import type { ExampleApplicationRuntime } from "../runtime/types";
import { DiagnosticsScreen } from "./diagnostics-screen";
import { KioskScreen } from "./kiosk-screen";

export const KioskApplication = ({ application }: { application: ExampleApplicationRuntime }) => {
  const router = createBrowserRouter([
    { path: "/", element: <Navigate to="/kiosk" replace /> },
    { path: "/kiosk", element: <KioskRoute application={application} /> },
    { path: "/diagnostics", element: <DiagnosticsScreen application={application} /> },
  ]);
  return <RouterProvider router={router} />;
};

const KioskRoute = ({ application }: { application: ExampleApplicationRuntime }) => {
  useEffect(
    () => () => {
      void application.runtime.interrupt("route.exit");
    },
    [application],
  );
  return <KioskScreen application={application} />;
};

import { lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { AppShell } from "@/components/shell/app-shell";
import { RouteFallback } from "@/components/shell/route-fallback";

/**
 * Routes are code-split per page so each module loads on demand — the shell
 * stays instant while feature pages (and their charts) lazy-load.
 */
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Performance = lazy(() => import("@/pages/performance"));
const Rgb = lazy(() => import("@/pages/rgb"));
const Battery = lazy(() => import("@/pages/battery"));
const Storage = lazy(() => import("@/pages/storage"));
const StorageAnalyzer = lazy(() => import("@/pages/storage-analyzer"));
const Tasks = lazy(() => import("@/pages/tasks"));
const Doctor = lazy(() => import("@/pages/doctor"));
const Optimizer = lazy(() => import("@/pages/optimizer"));
const Integrations = lazy(() => import("@/pages/integrations"));
const Game = lazy(() => import("@/pages/game"));
const Intelligence = lazy(() => import("@/pages/intelligence"));
const Settings = lazy(() => import("@/pages/settings"));

function withSuspense(node: React.ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: withSuspense(<Dashboard />) },
      { path: "performance", element: withSuspense(<Performance />) },
      { path: "rgb", element: withSuspense(<Rgb />) },
      { path: "battery", element: withSuspense(<Battery />) },
      { path: "storage", element: withSuspense(<Storage />) },
      { path: "storage-analyzer", element: withSuspense(<StorageAnalyzer />) },
      { path: "tasks", element: withSuspense(<Tasks />) },
      { path: "doctor", element: withSuspense(<Doctor />) },
      { path: "optimizer", element: withSuspense(<Optimizer />) },
      { path: "integrations", element: withSuspense(<Integrations />) },
      { path: "game", element: withSuspense(<Game />) },
      { path: "intelligence", element: withSuspense(<Intelligence />) },
      { path: "settings", element: withSuspense(<Settings />) },
    ],
  },
];

export const router = createBrowserRouter(routes);

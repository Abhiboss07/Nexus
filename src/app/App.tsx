import { RouterProvider } from "react-router-dom";
import { AppProviders } from "./providers";
import { ErrorBoundary } from "./error-boundary";
import { router } from "./router";

export default function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  );
}

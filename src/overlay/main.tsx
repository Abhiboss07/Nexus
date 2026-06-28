import { createRoot } from "react-dom/client";
import { OverlayApp } from "./overlay-app";
import "../styles/tokens.css";
import "../styles/base.css";

// No StrictMode here — the overlay's mount effects (play sound, schedule destroy)
// must run exactly once.
createRoot(document.getElementById("overlay-root")!).render(<OverlayApp />);

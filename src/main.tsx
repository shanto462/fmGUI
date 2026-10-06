import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";

// Browser preview with fake data (dev only): http://localhost:1420/?mock=1
// Variants: ?mock=nolicense, ?mock=nofm, ?mock=setup
if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
  const { installMocks } = await import("./lib/mock");
  installMocks();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const startupT0 = performance.now();
(window as typeof window & { __OMS_STARTUP_T0?: number }).__OMS_STARTUP_T0 = startupT0;
console.info("[OMS-startup] frontend.module-loaded", { elapsedMs: 0 });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

console.info("[OMS-startup] frontend.react-render-called", {
  elapsedMs: Math.round(performance.now() - startupT0)
});

requestAnimationFrame(() => {
  console.info("[OMS-startup] frontend.first-frame", {
    elapsedMs: Math.round(performance.now() - startupT0)
  });
});

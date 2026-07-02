import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import WayforkApp from "./WayforkApp.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <WayforkApp />
  </StrictMode>
);

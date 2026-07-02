import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import WayforkApp from "./ui/WayforkApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WayforkApp />
  </StrictMode>
);

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initAmbientFx } from "./lib/ambient-fx";

initAmbientFx();

createRoot(document.getElementById("root")!).render(<App />);

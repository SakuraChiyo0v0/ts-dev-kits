import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "./lib/use-theme";
import "./index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("未找到 #root 挂载点");

createRoot(root).render(
  <ThemeProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </ThemeProvider>,
);

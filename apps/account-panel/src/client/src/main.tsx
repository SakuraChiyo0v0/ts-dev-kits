import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "@/components/ui/toast";
import "./index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("未找到 #root 挂载点");

createRoot(root).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);

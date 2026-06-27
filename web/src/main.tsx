import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// 全局样式重置
const style = document.createElement("style");
style.textContent = `
  *, *::before, *::after {
    box-sizing: border-box;
  }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  input, button, textarea, select {
    font-family: inherit;
  }
`;
document.head.appendChild(style);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

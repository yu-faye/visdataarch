import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the same build works from a local preview and from the
// GitHub Pages sub-path (https://<user>.github.io/visdataarch/).
export default defineConfig({
  plugins: [react()],
  base: './',
});

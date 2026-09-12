// cytoscape-dagre ships no types of its own.
declare module 'cytoscape-dagre' {
  import type { Ext } from 'cytoscape';
  const extension: Ext;
  export default extension;
}

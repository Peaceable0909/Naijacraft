// Shared context for the game modules. main.js fills it in at boot; everything else reads from it.
export const $ = (id) => document.getElementById(id);

export const G = {
  isTouch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  settings: null,
  profile: null,
  state: null,           // gameplay state: mode, hotbar, selection, area / paste tools, time, weather
  engine: null, scene: null, camera: null, world: null, player: null, atlas: null,
  hud: null, achievements: null, minimap: null,
  myPlot: null,          // the PLOTS entry this player can build on, or null
  online: null,          // the online session, or null when playing offline
  owners: new Map(),     // plot number -> { owner, name } for every claimed plot
  undoStack: [],
  redoStack: [],
  hooks: {},             // callbacks installed by main.js (resumePlay, markPlotDirty, ...)
};

export const isOnline = () => !!G.online;

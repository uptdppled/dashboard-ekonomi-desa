// Validated categorical/status palette (light/dark pairs), per the dataviz
// skill's reference instance - CVD-safe adjacent pairs, contrast-checked
// against each mode's chart surface. SVG fill / Leaflet marker colors can't
// consume CSS custom properties reliably, so chart components pick a set
// here based on the resolved theme (see theme.jsx).

export const STATUS_COLORS = {
  light: {
    MANDIRI: '#008300',
    MAJU: '#2a78d6',
    BERKEMBANG: '#eda100',
    TERTINGGAL: '#eb6834',
    'SANGAT TERTINGGAL': '#e34948',
  },
  dark: {
    MANDIRI: '#008300',
    MAJU: '#3987e5',
    BERKEMBANG: '#c98500',
    TERTINGGAL: '#d95926',
    'SANGAT TERTINGGAL': '#e66767',
  },
};

export const QUADRAN_COLORS = {
  light: {
    'I - Potensi Tinggi, Kinerja Tinggi': '#008300',
    'II - Potensi Tinggi, Kinerja Rendah': '#eb6834',
    'III - Potensi Rendah, Kinerja Rendah': '#e34948',
    'IV - Potensi Rendah, Kinerja Tinggi': '#2a78d6',
  },
  dark: {
    'I - Potensi Tinggi, Kinerja Tinggi': '#008300',
    'II - Potensi Tinggi, Kinerja Rendah': '#d95926',
    'III - Potensi Rendah, Kinerja Rendah': '#e66767',
    'IV - Potensi Rendah, Kinerja Tinggi': '#3987e5',
  },
};

// Single-series chart accent (bars, primary series) - Banua360 brand Teal,
// swapping to the brighter Aqua in dark mode since that pairing only needs
// to read against the dark panel surface (not against overlaid white text,
// like a button would), where Aqua's contrast is actually strong; validated
// with the dataviz skill's scripts/validate_palette.js.
export const ACCENT = { light: '#167D8D', dark: '#2BB3A3' };
export const ACCENT_SECONDARY = { light: '#123B5D', dark: '#4a80b0' };

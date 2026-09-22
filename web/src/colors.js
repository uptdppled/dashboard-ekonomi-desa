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

// Single-series chart accent (bars, primary series)
export const ACCENT = { light: '#1baf7a', dark: '#199e70' };
export const ACCENT_SECONDARY = { light: '#2a78d6', dark: '#3987e5' };

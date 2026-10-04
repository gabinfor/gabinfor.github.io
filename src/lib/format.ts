export const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const isNew = (d: Date, days = 14) => Date.now() - +d < days * 864e5;

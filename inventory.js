// Meravs site data. Edit this file to change placeholders, watches, prices and stock.
// Everything marked SAMPLE is placeholder content for the design, not a confirmed product.

export const SITE = {
  launchMonth: 'October 2026',
  city: 'Gurugram',
  whatsapp: '916386609425',
  handle: '@meravs.official',
  email: 'Meravsfounders@gmail.com',
};

// dial: d0 centre, d1 mid, d2 edge, ink numerals, idx indices, sheen sunburst tint
// metal: 'gold' | 'steel' | 'rose' (a colour tone only, not a material claim)
// status: 'in' | 'out'
export const MODELS = [
  { ref: '01', gender: 'men', name: 'Reference 01', dialName: 'White striped', note: 'Fluted bezel', metal: 'gold', size: 40, price: 3950, status: 'in', // real product · size + price SAMPLE, confirm
    photo: 'ref-01.png', shape: 'round', bezel: 'fluted', hands: 'baton', secColor: '#C9A55C',
    bracelet: { centerW: 4.6, outerW: 5.9, outerX: 5.5, centerFinish: 'polished', outerFinish: 'polished', pitch: 3.7 },
    dial: { d0: '#FAF8F2', d1: '#EFECE3', d2: '#D8D3C4', ink: '#1B2330', idx: '#262B36', sheen: '#3A362C', style: 'stripes', stripeDir: 'h', numerals: 'dots', wordY: 0.34, sub: { text: 'Quartz', font: 'script', y: -0.34, size: 0.15 } } },
  { ref: '02', gender: 'men', name: 'Reference 02', dialName: 'Blue sunburst', note: 'Roman XII and VI', metal: 'steel', size: 40, price: 3450, status: 'in', // real product · size + price SAMPLE, confirm
    photo: 'ref-02.png', shape: 'round', bezel: 'smooth', hands: 'dauphine', hand: 'gold', secColor: '#E4E7EA',
    bracelet: { centerW: 6.4, outerW: 5.6, outerX: 6.2, centerFinish: 'polished', outerFinish: 'brushed', pitch: 4.4 },
    dial: { d0: '#2E518F', d1: '#1E3A6E', d2: '#0F2045', ink: '#EEF1F6', idx: '#E4E7EA', sheen: '#A8C0EC', numerals: 'xii-vi', ring: true, ringFill: 'rgba(255,255,255,0.07)' } },
  { ref: '03', gender: 'women', name: 'Reference 03', dialName: 'Silver striped', note: 'Two-tone tonneau', tone: 'Rose-gold and steel', metal: 'steel', accent: 'rose', hand: 'rose', crown: 'rose', size: 22, price: 2950, status: 'in', // real product · size + price SAMPLE, confirm
    photo: 'ref-03.png', photoAspect: '4/3', shape: 'tonneau', hands: 'slim', seconds: false,
    bracelet: { center: 'accent', scale: 0.78, pitch: 3.9, centerW: 6.2, outerW: 4.4, outerX: 5.6, centerFinish: 'polished', outerFinish: 'polished' },
    dial: { d0: '#F5F3EE', d1: '#E9E6DF', d2: '#D2CDC3', ink: '#4A3E34', idx: '#C08A62', sheen: '#4A423A', style: 'stripes', stripeDir: 'v', numerals: 'tonneau', font: 'serif', wordY: 0.3 } },
  { ref: '04', gender: 'men', name: 'Reference 04', dialName: 'Grey sunburst, red markers', note: 'Cushion case', metal: 'steel', size: 42, price: 3250, status: 'in', // real product · size + price SAMPLE, confirm
    photo: 'ref-04.png', photoAspect: '4/3', shape: 'cushion', hands: 'baton', caseFinish: 'polished',
    bracelet: { centerW: 8.4, outerW: 4.4, outerX: 6.8, centerFinish: 'brushed', outerFinish: 'polished', pitch: 5.2 },
    dial: { d0: '#8E9196', d1: '#71747A', d2: '#4B4E53', ink: '#F4F5F6', idx: '#D8322E', sheen: '#D4D8DE', numerals: 'dots', wordY: 0.3, sub: { text: 'Quartz', font: 'script', y: -0.34, size: 0.15 } } },
  { ref: '05', gender: 'women', name: 'Reference 05', dialName: 'Blue wave', note: 'Gold bangle with crystal shoulders', metal: 'gold', size: 20, price: 3450, status: 'in', // real product · size + price SAMPLE, confirm
    photo: 'ref-05.png', shape: 'eye', hands: 'slim', seconds: false, caseFinish: 'polished',
    bracelet: { center: 'metal', scale: 0.8, pitch: 1.6, centerW: 7.2, outerW: 0.01, outerX: 0, centerFinish: 'polished', gems: 5 },
    dial: { d0: '#3048B0', d1: '#23358C', d2: '#141F5C', ink: '#E9D9A8', idx: '#D9BC7C', sheen: '#9FB0F0', style: 'waves', numerals: 'eye', font: 'serif', wordY: -0.3 } },
  { ref: '06', gender: 'men', name: 'Reference 06', dialName: 'Forest', metal: 'steel', size: 40, price: 3650, status: 'out', // SAMPLE
    dial: { d0: '#24463B', d1: '#18332B', d2: '#0D1D18', ink: '#EFE7D4', idx: '#E4E7EA', sheen: '#8FC0A8' } },
];

export const METAL = { gold: { hex: '#D3B06A', label: 'Gold-tone' }, steel: { hex: '#C9CDD2', label: 'Steel-tone' }, rose: { hex: '#D9A98C', label: 'Rose-gold and steel' } };

export const findModel = ref => MODELS.find(m => m.ref === ref) || MODELS[0];
export const formatPrice = n => '₹' + n.toLocaleString('en-IN');
export const describe = m => [m.dialName, m.tone || METAL[m.metal].label, m.note, `${m.size}mm`].filter(Boolean).join(' · ');

const KEY = 'meravs-list';
export function getList() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } }
export function setList(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) {}
  window.dispatchEvent(new CustomEvent('meravs-list'));
}
export function toggleInList(ref) {
  const l = getList(); const i = l.indexOf(ref);
  if (i >= 0) l.splice(i, 1); else l.push(ref);
  setList(l); return i < 0;
}
export function onListChange(fn) {
  const h = () => fn(getList());
  window.addEventListener('meravs-list', h); window.addEventListener('storage', h);
  return () => { window.removeEventListener('meravs-list', h); window.removeEventListener('storage', h); };
}
export const waLink = text => `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(text)}`;
export const JOIN_TEXT = 'Hi%20Meravs%20—%20add%20me%20to%20the%20launch%20list';
export const joinLink = () => `https://wa.me/${SITE.whatsapp}?text=${JOIN_TEXT}`;
export const igLink = () => `https://instagram.com/${SITE.handle.replace(/^@/, '')}`;

export const orderLink = m => waLink(`Hi Meravs, I'd like to order ${m.name} (${describe(m)}) at ${formatPrice(m.price)}.`);
export const GENDER = { men: 'Men', women: 'Women' };

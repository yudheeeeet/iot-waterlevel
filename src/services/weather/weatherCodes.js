/**
 * Normalises BMKG weather codes and WMO codes (Open-Meteo) into one set of
 * icon kinds so both sources render identically in the UI.
 * Icon kinds: sun | cloud-sun | cloud | fog | rain | storm
 */

export const SEVERITY = { sun: 0, 'cloud-sun': 1, cloud: 2, fog: 2, rain: 4, storm: 5 };

const BMKG = {
  0: ['sun', 'Clear'], 100: ['sun', 'Clear'],
  1: ['cloud-sun', 'Partly cloudy'], 2: ['cloud-sun', 'Partly cloudy'],
  101: ['cloud-sun', 'Partly cloudy'], 102: ['cloud-sun', 'Partly cloudy'],
  3: ['cloud', 'Cloudy'], 103: ['cloud', 'Cloudy'],
  4: ['cloud', 'Overcast'], 104: ['cloud', 'Overcast'],
  5: ['fog', 'Haze'], 10: ['fog', 'Smoke'], 45: ['fog', 'Fog'],
  60: ['rain', 'Light rain'], 61: ['rain', 'Rain'], 63: ['rain', 'Heavy rain'],
  80: ['rain', 'Local rain'],
  95: ['storm', 'Thunderstorm'], 97: ['storm', 'Thunderstorm'],
};

export function fromBmkg(code, descEn) {
  const [icon, label] = BMKG[Number(code)] || ['cloud', 'Cloudy'];
  return { icon, condition: descEn || label };
}

export function fromWmo(code) {
  const c = Number(code);
  if (c === 0) return { icon: 'sun', condition: 'Clear' };
  if (c === 1 || c === 2) return { icon: 'cloud-sun', condition: 'Partly cloudy' };
  if (c === 3) return { icon: 'cloud', condition: 'Overcast' };
  if (c === 45 || c === 48) return { icon: 'fog', condition: 'Fog' };
  if (c >= 51 && c <= 55) return { icon: 'rain', condition: 'Drizzle' };
  if (c === 61 || c === 80) return { icon: 'rain', condition: 'Light rain' };
  if (c === 63 || c === 81) return { icon: 'rain', condition: 'Rain' };
  if (c === 65 || c === 82) return { icon: 'rain', condition: 'Heavy rain' };
  if (c >= 56 && c <= 67) return { icon: 'rain', condition: 'Rain' };
  if (c >= 95) return { icon: 'storm', condition: 'Thunderstorm' };
  return { icon: 'cloud', condition: 'Cloudy' };
}

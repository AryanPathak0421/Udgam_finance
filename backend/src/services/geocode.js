/**
 * Google Maps (Geocoding API): the address of a latitude / longitude, shown and kept with the attendance of an employee. The key of the environment
 * (GOOGLE_MAPS_API_KEY) is used on the server only. When it is not set, or Google does not answer, there is simply no address (the attendance is not stopped).
 */
export const mapsConfigured = () => Boolean((process.env.GOOGLE_MAPS_API_KEY || '').trim());

export async function reverseGeocode(lat, lng) {
  const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
  const la = Number(lat);
  const ln = Number(lng);
  if (!key || !Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return '';
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${la},${ln}&language=en&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(6000) });
    const json = await res.json();
    if (json.status !== 'OK') return '';
    return String(json.results?.[0]?.formatted_address || '').slice(0, 300);
  } catch {
    return '';
  }
}

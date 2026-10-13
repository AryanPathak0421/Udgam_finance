import { INDIA_LOCATIONS, STATES } from '../data/indiaLocations.js';

export function getStates(_req, res) {
  res.json({ states: STATES });
}

export function getCities(req, res) {
  const cities = INDIA_LOCATIONS[req.query.state] || [];
  res.json({ cities: [...cities].sort() });
}

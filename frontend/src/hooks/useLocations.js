import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

// Loads states once, and cities whenever the selected state changes.
export default function useLocations(state) {
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);

  useEffect(() => {
    let live = true;
    api.meta.states().then((d) => live && setStates(d.states)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!state) {
      setCities([]);
      return undefined;
    }
    let live = true;
    api.meta.cities(state).then((d) => live && setCities(d.cities)).catch(() => live && setCities([]));
    return () => {
      live = false;
    };
  }, [state]);

  return { states, cities };
}

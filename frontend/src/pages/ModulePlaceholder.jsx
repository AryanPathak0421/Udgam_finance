import { useLocation } from 'react-router-dom';
import { routableItems } from '../config/nav.js';

export default function ModulePlaceholder() {
  const { pathname } = useLocation();
  const item = routableItems().find((i) => i.path === pathname);
  return (
    <div className="panel">
      <h3>{item ? item.label : 'Module'}</h3>
      <div className="empty">This module is not built yet.</div>
    </div>
  );
}

import { AuditLog } from '../models/AuditLog.js';

const strip = (doc) => {
  if (!doc) return undefined;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete o.__v;
  // Do not copy large binary-ish values into the trail.
  if (o.stampImage) o.stampImage = '[image]';
  return o;
};

// Audit failures must never break the business operation.
export async function audit(req, { action, entity, entityId, before, after }) {
  try {
    await AuditLog.create({
      actor: req.user._id,
      actorEmail: req.user.email,
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      before: strip(before),
      after: strip(after),
      ip: req.ip,
    });
  } catch (err) {
    console.error('audit write failed:', err.message);
  }
}

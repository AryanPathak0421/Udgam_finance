import { AppUser } from '../models/AppUser.js';

/** A request from the mobile app: the app says so (header X-Client: app) and the user is an active app user. */
export async function isAppRequest(req) {
  if (String(req.headers?.['x-client'] || '').toLowerCase() !== 'app') return false;
  return Boolean(await AppUser.exists({ user: req.user._id, isActive: true }));
}

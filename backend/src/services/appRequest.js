import { AppUser } from '../models/AppUser.js';

/**
 * A request from the mobile app: it came through the app's own URLs (/api/app/...), or says so with the header X-Client: app, and the user is an active app user.
 */
export async function isAppRequest(req) {
  if (req.appClient !== true && String(req.headers?.['x-client'] || '').toLowerCase() !== 'app') return false;
  return Boolean(await AppUser.exists({ user: req.user._id, isActive: true }));
}

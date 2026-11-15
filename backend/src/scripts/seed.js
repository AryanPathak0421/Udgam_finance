import 'dotenv/config';
import mongoose from 'mongoose';
import dns from 'node:dns';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';

if (process.env.MONGODB_URI?.includes('mongodb+srv')) {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch {}
}

await mongoose.connect(process.env.MONGODB_URI);

const email = 'admin@gmail.com';
const password = 'password';

const hashedPassword = await bcrypt.hash(password, 12);

let user = await User.findOne({ email }).select('+password');
if (user) {
  user.password = password;
  user.role = 'super_admin';
  user.isActive = true;
  user.failedAttempts = 0;
  user.lockUntil = undefined;
  await user.save();
  console.log('Admin user updated:', email);
} else {
  user = await User.create({
    name: 'Admin',
    email,
    password,
    role: 'super_admin',
    isActive: true,
  });
  console.log('Admin user created:', email);
}

// Fetch again with password to verify
const verifiedUser = await User.findOne({ email }).select('+password');
const isValid = await verifiedUser.matchPassword(password);
console.log('Verification: Admin can log in with "password":', isValid);
console.log('Admin User Details:', {
  id: verifiedUser._id,
  name: verifiedUser.name,
  email: verifiedUser.email,
  role: verifiedUser.role,
  isActive: verifiedUser.isActive,
});

await mongoose.disconnect();
console.log('Database disconnected successfully.');



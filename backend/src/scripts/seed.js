import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/User.js';

await mongoose.connect(process.env.MONGODB_URI);

const email = 'admin@gmail.com';
const user = await User.findOne({ email });
if (user) {
  user.password = 'password';
  user.role = 'super_admin';
  user.isActive = true;
  user.failedAttempts = 0;
  user.lockUntil = undefined;
  await user.save();
  console.log('Admin user updated');
} else {
  await User.create({ name: 'Admin', email, password: 'password', role: 'super_admin' });
  console.log('Admin user created');
}

await mongoose.disconnect();

import mongoose from 'mongoose';
import dns from 'node:dns';

export async function connectDB() {
  if (process.env.MONGODB_URI?.includes('mongodb+srv')) {
    try {
      dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
    } catch {
      // ignore
    }
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
}

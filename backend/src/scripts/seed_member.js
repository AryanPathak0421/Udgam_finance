import 'dotenv/config';
import dns from 'node:dns';
import mongoose from 'mongoose';
import { ensureMemberSeed } from '../services/seedMemberHelper.js';
import { Member } from '../models/Member.js';
import { MemberMpin } from '../modules/member/memberAppModel.js';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {
  // ignore
}

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/udgam_finance';
console.log('Connecting to MongoDB...');
await mongoose.connect(uri);
console.log('Connected to MongoDB');

await ensureMemberSeed();

const members = await Member.find({
  mobile: { $in: ['9876501234', '9876543210', '9999912345'] },
  isDeleted: false,
});

console.log('\n======================================================');
console.log('        UDGAM MEMBER APP LOGIN CREDENTIALS');
console.log('======================================================');
for (const mem of members) {
  const mpinDoc = await MemberMpin.findOne({ member: mem._id }).select('+mpinHash');
  const valid = mpinDoc ? await mpinDoc.compareMpin('1234') : false;
  console.log(`- Member Name : ${mem.name}`);
  console.log(`  Member Code : ${mem.code}`);
  console.log(`  Mobile No   : ${mem.mobile}`);
  console.log(`  Secret mPIN : 1234 (${valid ? 'Verified OK' : 'Not set'})`);
  console.log(`  Status      : ${mem.isActive ? 'Active' : 'Inactive'}`);
  console.log('------------------------------------------------------');
}
console.log('======================================================\n');

await mongoose.disconnect();


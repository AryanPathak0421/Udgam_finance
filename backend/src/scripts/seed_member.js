import 'dotenv/config';
import mongoose from 'mongoose';
import { ensureMemberSeed } from '../services/seedMemberHelper.js';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/udgam_finance';
console.log('Connecting to MongoDB...');
await mongoose.connect(uri);
console.log('Connected to MongoDB');

await ensureMemberSeed();

console.log('\n======================================================');
console.log('        UDGAM MEMBER (CUSTOMER) SEED SUCCESSFUL');
console.log('======================================================');
console.log('  Mobile Number : 9876501234');
console.log('  Member Code   : MEM001');
console.log('  Secret mPIN   : 1234');
console.log('  Name          : Sunita Devi (Member)');
console.log('  Sample Loan   : 1 Active Micro Loan with 2 EMIs paid');
console.log('======================================================\n');

await mongoose.disconnect();

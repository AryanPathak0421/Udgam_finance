import mongoose from 'mongoose';
import { Member } from '../models/Member.js';
import { Branch } from '../models/Branch.js';
import { MemberMpin } from '../modules/member/memberAppModel.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { LoanRequisition } from '../models/LoanRequisition.js';

export async function ensureMemberSeed() {
  try {
    const mobile = process.env.SEED_MEMBER_MOBILE || '9876501234';
    const code = (process.env.SEED_MEMBER_CODE || 'MEM001').toUpperCase();
    const formId = (process.env.SEED_MEMBER_FORM_ID || 'F001').toUpperCase();
    const mpin = process.env.SEED_MEMBER_MPIN || '1234';
    const name = process.env.SEED_MEMBER_NAME || 'Sunita Devi (Member)';

    let branch = await Branch.findOne({ isDeleted: false });
    if (!branch) {
      branch = await Branch.create({
        code: 'BR001',
        name: 'Head Office Branch',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800001',
        address: 'Main Road',
        openingDate: new Date('2024-01-01'),
        isActive: true,
      });
    }

    // 1. Find or create dummy Member
    let mem = await Member.findOne({
      $or: [{ code }, { mobile }, { formId }],
      isDeleted: false,
    });

    if (!mem) {
      mem = await Member.create({
        code,
        formId,
        branch: branch._id,
        name,
        dob: new Date('1990-05-15'),
        gender: 'female',
        mobile,
        mobileVerifiedAt: new Date(),
        email: 'sunita.devi@udgam.local',
        husbandName: 'Ramesh Kumar',
        occupation: 'Self Employed (Dairy / Grocery)',
        education: 'Secondary School',
        address: 'Village Rampur, Ward No 4',
        pincode: '802119',
        state: 'Bihar',
        district: 'Buxar',
        area: 'Dumraon',
        aadhaar: '998877665544',
        pan: 'ABCDE1234F',
        bankName: 'State Bank of India',
        ifsc: 'SBIN0001234',
        accountNumber: '32109876543',
        joiningDate: new Date('2024-02-01'),
        guarantor: {
          name: 'Ramesh Kumar',
          mobile: '9876509999',
          aadhaar: '112233445566',
        },
        isActive: true,
        isBlocked: false,
      });
      console.log(`[Seed] Created dummy Member: ${mem.name} (${mem.code})`);
    } else {
      mem.name = name;
      mem.mobile = mobile;
      mem.code = code;
      mem.isActive = true;
      mem.isBlocked = false;
      await mem.save();
    }

    // 2. Set MemberMpin
    const mpinHash = await MemberMpin.hashMpin(mpin);
    let mpinDoc = await MemberMpin.findOne({ member: mem._id });
    if (mpinDoc) {
      mpinDoc.mpinHash = mpinHash;
      mpinDoc.mobile = mobile;
      mpinDoc.memberCode = code;
      mpinDoc.failedAttempts = 0;
      await mpinDoc.save();
    } else {
      await MemberMpin.create({
        member: mem._id,
        memberCode: code,
        mobile,
        mpinHash,
      });
    }

    // 3. Ensure a sample loan and EMI records exist for rich dashboard data
    const existingLoan = await LoanPayment.findOne({
      status: 'paid',
      $or: [{ 'lines.member': mem._id }, { 'lines.code': mem.code }],
    });

    if (!existingLoan) {
      // Find or create dummy loan requisition
      let req = await LoanRequisition.findOne({ memberCode: mem.code });
      if (!req) {
        req = await LoanRequisition.create({
          formId: mem.formId,
          requisitionNo: `REQ-${mem.code}`,
          branch: branch._id,
          member: mem._id,
          memberCode: mem.code,
          memberName: mem.name,
          mobile: mem.mobile,
          loanType: 'personal',
          schemeName: 'Mahila Kalyan Micro Loan',
          appliedAmountPaise: 2500000,
          approvedAmountPaise: 2500000,
          status: 'approved',
          approvedOn: new Date('2024-03-01'),
        });
      }

      // Generate 20 installment schedule
      const schedule = [];
      const installmentPaise = 135000; // 1350 Rs
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30); // 30 days ago

      for (let i = 1; i <= 20; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + (i * 7)); // weekly schedule
        schedule.push({
          no: i,
          dueDate: d,
          installmentPaise,
          principalPaise: 125000,
          interestPaise: 10000,
        });
      }

      const loanPayment = await LoanPayment.create({
        receiptNo: `LREC-${mem.code}-1`,
        loanId: `LON-${mem.code}-01`,
        requisition: req._id,
        formId: mem.formId,
        kind: 'disbursement',
        branch: branch._id,
        paidOn: startDate,
        emiStartDate: schedule[0].dueDate,
        emiEndDate: schedule[19].dueDate,
        installments: 20,
        modeLabel: 'Weekly',
        mode: 'weekly',
        loanType: 'personal',
        schemeName: 'Mahila Kalyan Micro Loan',
        annualRateBp: 1800,
        installmentPaise,
        payMode: 'bank',
        schedule,
        lines: [
          {
            member: mem._id,
            code: mem.code,
            name: mem.name,
            amountPaise: 2500000,
            processingFeePaise: 50000,
            securityPaise: 125000,
            cashPaise: 2325000,
          },
        ],
        totalAmountPaise: 2500000,
        status: 'paid',
      });

      // Add 2 paid EMIs
      await EmiPayment.create({
        receiptNo: `EMI-${mem.code}-001`,
        loanPayment: loanPayment._id,
        loanId: loanPayment.loanId,
        formId: mem.formId,
        branch: branch._id,
        type: 'regular',
        member: mem._id,
        memberCode: mem.code,
        memberName: mem.name,
        installments: [1],
        items: [{ no: 1, dueDate: schedule[0].dueDate, amountPaise: installmentPaise }],
        amountPaise: installmentPaise,
        paidOn: schedule[0].dueDate,
        payMode: 'cash',
        status: 'paid',
      });

      await EmiPayment.create({
        receiptNo: `EMI-${mem.code}-002`,
        loanPayment: loanPayment._id,
        loanId: loanPayment.loanId,
        formId: mem.formId,
        branch: branch._id,
        type: 'regular',
        member: mem._id,
        memberCode: mem.code,
        memberName: mem.name,
        installments: [2],
        items: [{ no: 2, dueDate: schedule[1].dueDate, amountPaise: installmentPaise }],
        amountPaise: installmentPaise,
        paidOn: schedule[1].dueDate,
        payMode: 'cash',
        status: 'paid',
      });

      console.log(`[Seed] Created sample Loan (${loanPayment.loanId}) and 2 EMIs for member ${mem.code}`);
    }

    console.log(`[Seed] Member dummy credentials ready: ${mobile} (${code}) / mPIN: ${mpin}`);
  } catch (err) {
    console.warn('[Seed] Member auto-seed notice:', err.message);
  }
}

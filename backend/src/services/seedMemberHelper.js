import mongoose from 'mongoose';
import { Member } from '../models/Member.js';
import { Branch } from '../models/Branch.js';
import { MemberMpin } from '../modules/member/memberAppModel.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { LoanRequisition } from '../models/LoanRequisition.js';
import { LoanScheme } from '../models/LoanScheme.js';

export async function ensureMemberSeed() {
  const dummyImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const memberList = [
    {
      mobile: process.env.SEED_MEMBER_MOBILE || '9876501234',
      code: (process.env.SEED_MEMBER_CODE || 'MEM001').toUpperCase(),
      formId: (process.env.SEED_MEMBER_FORM_ID || 'F001').toUpperCase(),
      mpin: process.env.SEED_MEMBER_MPIN || '1234',
      name: process.env.SEED_MEMBER_NAME || 'Sunita Devi (Member)',
      husbandName: 'Ramesh Kumar',
      village: 'Village Rampur, Ward No 4',
      district: 'Buxar',
      aadhaar: '998877665541',
      pan: 'ABCDE1234A',
      accountNumber: '32109876541',
      loanAmount: 2500000,
    },
    {
      mobile: '9876543210',
      code: 'MEM002',
      formId: 'F002',
      mpin: '1234',
      name: 'Pooja Sharma (Member)',
      husbandName: 'Vikash Sharma',
      village: 'Brahampur Main Road',
      district: 'Buxar',
      aadhaar: '998877665542',
      pan: 'ABCDE1234B',
      accountNumber: '32109876542',
      loanAmount: 3000000,
    },
    {
      mobile: '9999912345',
      code: 'MEM003',
      formId: 'F003',
      mpin: '1234',
      name: 'Anita Kumari (Member)',
      husbandName: 'Sanjay Kumar',
      village: 'Dumraon Station Road',
      district: 'Buxar',
      aadhaar: '998877665543',
      pan: 'ABCDE1234C',
      accountNumber: '32109876543',
      loanAmount: 2000000,
    },
  ];

  try {
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

    for (const item of memberList) {
      const { mobile, code, formId, mpin, name, husbandName, village, district, aadhaar, pan, accountNumber, loanAmount } = item;

      // 1. Find or create Member
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
          email: `${code.toLowerCase()}@udgam.local`,
          husbandName,
          occupation: 'Self Employed (Dairy / Grocery)',
          education: 'Secondary School',
          address: village,
          pincode: '802119',
          state: 'Bihar',
          district,
          area: 'Dumraon',
          aadhaar: aadhaar || '998877665544',
          pan: pan || 'ABCDE1234F',
          bankName: 'State Bank of India',
          ifsc: 'SBIN0001234',
          accountNumber: accountNumber || '32109876543',
          joiningDate: new Date('2024-02-01'),
          legacyImport: true,
          memberPhoto: dummyImg,
          signaturePhoto: dummyImg,
          aadhaarPhoto: dummyImg,
          aadhaarBackPhoto: dummyImg,
          guarantor: {
            name: husbandName,
            mobile: '9876509999',
            aadhaar: '112233445566',
            photo: dummyImg,
            signature: dummyImg,
            aadhaarPhoto: dummyImg,
          },
          nominee: {
            name: husbandName,
            mobile: '9876509999',
            aadhaar: '112233445566',
            photo: dummyImg,
            signature: dummyImg,
            aadhaarPhoto: dummyImg,
            sameAsGuarantor: true,
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
        mem.legacyImport = true;
        if (!mem.memberPhoto) mem.memberPhoto = dummyImg;
        if (!mem.signaturePhoto) mem.signaturePhoto = dummyImg;
        if (!mem.aadhaarPhoto) mem.aadhaarPhoto = dummyImg;
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
        let scheme = await LoanScheme.findOne({ isDeleted: false });
        if (!scheme) {
          scheme = await LoanScheme.create({
            name: 'Mahila Kalyan Micro Loan',
            code: 'SCH-MKM',
            loanType: 'business',
            repaymentMode: 'weekly',
            term: 20,
            interestRate: 18,
            interestType: 'flat',
            minAmount: 5000,
            maxAmount: 50000,
          });
        }

        const installmentPaise = Math.round((loanAmount / 20) * 1.08);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);

        let req = await LoanRequisition.findOne({ formId: mem.formId });
        if (!req) {
          req = await LoanRequisition.create({
            formId: mem.formId,
            branch: branch._id,
            loanDate: new Date('2024-03-01'),
            scheme: scheme._id,
            schemeName: scheme.name,
            loanType: 'business',
            amountPaise: loanAmount,
            mode: 'weekly',
            term: 20,
            annualRateBp: 1800,
            installmentPaise,
            employeeCode: 'EMP001',
            status: 'approved',
            appliedOn: new Date('2024-02-20'),
            approvedOn: new Date('2024-03-01'),
            borrowers: [
              {
                member: mem._id,
                code: mem.code,
                name: mem.name,
                mobile: mem.mobile,
                amountPaise: loanAmount,
                installmentPaise,
              },
            ],
          });
        }

        const schedule = [];

        for (let i = 1; i <= 20; i++) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + (i * 7));
          schedule.push({
            no: i,
            dueDate: d,
            installmentPaise,
            principalPaise: Math.round(loanAmount / 20),
            interestPaise: installmentPaise - Math.round(loanAmount / 20),
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
              amountPaise: loanAmount,
              processingFeePaise: 50000,
              securityPaise: 125000,
              cashPaise: loanAmount - 175000,
            },
          ],
          totalAmountPaise: loanAmount,
          status: 'paid',
        });

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
    }
  } catch (err) {
    console.warn('[Seed] Member auto-seed notice:', err.message);
  }
}


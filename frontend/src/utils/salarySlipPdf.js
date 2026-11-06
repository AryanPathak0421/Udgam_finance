/**
 * Generates and downloads a clean, professional Salary Slip PDF using jsPDF.
 */
export async function downloadSalarySlipPdf(slip, companyName = 'Udgam Micro Finance') {
  if (!slip) return;
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 15;
  let y = 18;

  // Header Banner
  doc.setFillColor(16, 120, 112); // Udgam primary teal
  doc.rect(M, y, W - 2 * M, 22, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(companyName.toUpperCase(), W / 2, y + 9, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`SALARY SLIP FOR THE MONTH OF: ${slip.month || 'N/A'}`, W / 2, y + 16, { align: 'center' });

  y += 28;

  // Employee Information Box
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, W - 2 * M, 32, 2, 2, 'FD');

  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);

  const col1 = M + 4;
  const col2 = M + 94;

  doc.setFont('helvetica', 'normal');
  doc.text('Employee Name:', col1, y + 7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(String(slip.name || 'Staff'), col1 + 32, y + 7);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(70, 70, 70);
  doc.text('Employee Code:', col2, y + 7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(String(slip.employeeCode || slip.code || 'N/A'), col2 + 30, y + 7);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(70, 70, 70);
  doc.text('Designation:', col1, y + 14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(String(typeof slip.designation === 'object' ? slip.designation?.name : slip.designation || 'Staff'), col1 + 32, y + 14);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(70, 70, 70);
  doc.text('Branch:', col2, y + 14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(String(typeof slip.branch === 'object' ? (slip.branch?.name || slip.branch?.code) : slip.branch || 'Head Office'), col2 + 30, y + 14);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(70, 70, 70);
  doc.text('Payable Days:', col1, y + 21);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(`${slip.payableDays ?? slip.presentDays ?? 30} of ${slip.daysInMonth || 30} Days`, col1 + 32, y + 21);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(70, 70, 70);
  doc.text('Absent Days:', col2, y + 21);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(190, 30, 30);
  doc.text(`${slip.absentDays || 0} Days`, col2 + 30, y + 21);

  y += 38;

  // Earnings and Deductions Table
  const tableW = (W - 2 * M) / 2;
  const leftX = M;
  const rightX = M + tableW;

  // Header Row
  doc.setFillColor(230, 245, 243);
  doc.rect(leftX, y, tableW, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 90, 90);
  doc.text('EARNINGS', leftX + 4, y + 5.5);
  doc.text('AMOUNT (₹)', leftX + tableW - 4, y + 5.5, { align: 'right' });

  doc.setFillColor(254, 242, 242);
  doc.rect(rightX, y, tableW, 8, 'F');
  doc.setTextColor(180, 40, 40);
  doc.text('DEDUCTIONS', rightX + 4, y + 5.5);
  doc.text('AMOUNT (₹)', rightX + tableW - 4, y + 5.5, { align: 'right' });

  y += 10;
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);

  const earnings = [
    ['Basic Pay', Number(slip.basicSalary || slip.grossSalary || 0)],
    ...(slip.fuelAllowance ? [['Fuel Allowance', Number(slip.fuelAllowance)]] : []),
    ...(slip.allowances ? [['Other Allowances', Number(slip.allowances)]] : []),
  ];

  const deductions = [
    ['Absent Deduction (Basic+Fuel)', Number(slip.absentDeduction || 0)],
    ...(slip.pfDeduction ? [['Provident Fund (PF)', Number(slip.pfDeduction)]] : []),
    ...(slip.esiDeduction ? [['ESI Deduction', Number(slip.esiDeduction)]] : []),
    ...(slip.advanceDeduction ? [['Salary Advance Recovery', Number(slip.advanceDeduction)]] : []),
    ...(slip.securityDeduction ? [['Security Deposit Cut', Number(slip.securityDeduction)]] : []),
  ];

  const maxRows = Math.max(earnings.length, deductions.length);
  for (let i = 0; i < maxRows; i++) {
    const earn = earnings[i];
    const ded = deductions[i];

    doc.setFont('helvetica', 'normal');
    if (earn) {
      doc.text(earn[0], leftX + 4, y + 4);
      doc.text(`₹${earn[1].toLocaleString('en-IN')}`, leftX + tableW - 4, y + 4, { align: 'right' });
    }
    if (ded) {
      doc.text(ded[0], rightX + 4, y + 4);
      doc.text(`-₹${ded[1].toLocaleString('en-IN')}`, rightX + tableW - 4, y + 4, { align: 'right' });
    }

    doc.setDrawColor(240, 240, 240);
    doc.line(leftX, y + 6, W - M, y + 6);
    y += 7;
  }

  y += 4;

  // Totals Row
  doc.setDrawColor(200, 200, 200);
  doc.line(leftX, y, W - M, y);
  y += 5;

  const totalEarnings = Number(slip.grossSalary || (slip.basicSalary + (slip.allowances || 0) + (slip.fuelAllowance || 0)));
  const totalDeductions = Number(slip.deductions || slip.absentDeduction || 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 90, 90);
  doc.text('Total Earnings:', leftX + 4, y + 2);
  doc.text(`₹${totalEarnings.toLocaleString('en-IN')}`, leftX + tableW - 4, y + 2, { align: 'right' });

  doc.setTextColor(180, 40, 40);
  doc.text('Total Deductions:', rightX + 4, y + 2);
  doc.text(`₹${totalDeductions.toLocaleString('en-IN')}`, rightX + tableW - 4, y + 2, { align: 'right' });

  y += 14;

  // Net Take-Home Salary Banner
  const netPay = Number(slip.netSalary || (totalEarnings - totalDeductions));
  doc.setFillColor(16, 120, 112);
  doc.roundedRect(M, y, W - 2 * M, 18, 3, 3, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text('NET SALARY PAYABLE:', M + 8, y + 11.5);

  doc.setFontSize(15);
  doc.text(`INR ₹${netPay.toLocaleString('en-IN')}`, W - M - 8, y + 12, { align: 'right' });

  y += 30;

  // Payment Status & Timestamp
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`Status: ${(slip.status || 'Generated').toUpperCase()}`, M, y);
  if (slip.paidOn || slip.paymentDate) {
    doc.text(`Payment Date: ${new Date(slip.paidOn || slip.paymentDate).toLocaleDateString('en-IN')}`, M + 60, y);
  }
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`, W - M, y, { align: 'right' });

  y += 12;
  doc.setDrawColor(220, 220, 220);
  doc.line(M, y, W - M, y);
  y += 6;

  doc.setFontSize(7.5);
  doc.setTextColor(140, 140, 140);
  doc.text('Note: This is a system-generated salary slip and does not require a physical signature.', W / 2, y, { align: 'center' });

  // Save / Trigger Download
  const filename = `Salary_Slip_${slip.month || 'statement'}_${slip.employeeCode || slip.code || 'emp'}.pdf`;
  doc.save(filename);
}



const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

/** Builds the member application PDF (borrower, guarantor, nominee and photos) and downloads it. */
export async function downloadMemberPdf(m, { company = 'Udgam Microfinance' } = {}) {
  const { jsPDF } = await import('jspdf'); // loaded on demand (keeps the main bundle small)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 14;
  let y = 16;

  const ensure = (h) => {
    if (y + h > 285) {
      doc.addPage();
      y = 16;
    }
  };
  const heading = (t) => {
    ensure(12);
    y += 3;
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(15, 90, 90);
    doc.text(t, M, y);
    doc.setDrawColor(200).line(M, y + 1.5, W - M, y + 1.5);
    y += 7;
    doc.setTextColor(30);
  };
  const rows = (pairs) => {
    doc.setFontSize(10);
    for (let i = 0; i < pairs.length; i += 2) {
      ensure(10);
      [pairs[i], pairs[i + 1]].forEach((p, c) => {
        if (!p) return;
        const x = M + c * 92;
        doc.setFont('helvetica', 'normal').setTextColor(110);
        doc.text(p[0], x, y);
        doc.setFont('helvetica', 'bold').setTextColor(30);
        const lines = doc.splitTextToSize(String(p[1] || '-'), 88);
        doc.text(lines, x, y + 5);
      });
      const tallest = Math.max(...[pairs[i], pairs[i + 1]].filter(Boolean).map((p) => doc.splitTextToSize(String(p[1] || '-'), 88).length));
      y += 5 + tallest * 4.6 + 2;
    }
  };
  const photos = (items) => {
    const shown = items.filter(([, src]) => src);
    if (!shown.length) return;
    ensure(44);
    let x = M;
    shown.forEach(([label, src]) => {
      if (x + 42 > W - M) {
        x = M;
        y += 46;
        ensure(44);
      }
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110).text(label, x, y);
      try {
        doc.addImage(src, /png/.test(src.slice(0, 20)) ? 'PNG' : 'JPEG', x, y + 2, 40, 34);
      } catch {
        doc.text('(image)', x, y + 10);
      }
      x += 46;
    });
    y += 42;
  };

  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(15, 90, 90).text(company, M, y);
  doc.setFontSize(11).setTextColor(60).text('Member Application Form', M, y + 7);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, W - M, y, { align: 'right' });
  doc.text(`Employee ID: ${m.employeeCode || '-'}`, W - M, y + 5, { align: 'right' });
  y += 12;

  heading('Member details');
  rows([
    ['Member code', m.code], ['Form ID', m.formId],
    ['Branch', m.branch ? `${m.branch.code} - ${m.branch.name}` : ''], ['Joining date', m.joiningDate],
    ['Member name', m.name], ['Husband name', m.husbandName],
    ['Date of birth', m.dob], ['Gender', cap(m.gender)],
    ['Mobile', `${m.mobile}${m.mobileVerified ? ' (verified)' : ''}`], ['Email', m.email],
    ['Occupation', m.occupation], ['Education', m.education],
    ['Address', `${m.address}, ${m.district}, ${m.state} - ${m.pincode}`], ['', ''],
    ['Aadhaar number', m.aadhaar], ['PAN number', m.pan ? `${m.pan}${m.panVerified ? ' (verified)' : ''}` : ''],
    ['Bank name', m.bankName], ['IFSC code', m.ifsc],
    ['Account number', m.accountNumber], ['', ''],
  ].filter((p, i, a) => p[0] || a[i ^ 1]?.[0]));
  photos([['Member photo', m.memberPhoto], ['Signature', m.signaturePhoto], ['Aadhaar front', m.aadhaarPhoto], ['Aadhaar back', m.aadhaarBackPhoto], ['PAN', m.panPhoto]]);

  [['Guarantor details', m.guarantor], ['Nominee details', m.nominee]].forEach(([title, p]) => {
    heading(title);
    if (!p) {
      doc.setFont('helvetica', 'italic').setFontSize(10).setTextColor(120).text('Not added yet', M, y);
      y += 6;
      return;
    }
    rows([
      ['Name', p.name], ['Mobile', p.mobile ? `${p.mobile}${p.mobileVerified ? ' (verified)' : ''}` : ''],
      ['Aadhaar number', p.aadhaar], ['PAN number', p.pan],
      ...(p.sameAsGuarantor ? [['Note', 'Same person as the guarantor'], ['', '']] : []),
    ]);
    photos([['Photo', p.photo], ['Signature', p.signature], ['Aadhaar front', p.aadhaarPhoto], ['Aadhaar back', p.aadhaarBackPhoto], ['PAN', p.panPhoto], ['Joint photo', p.jointPhoto]]);
  });

  doc.save(`${m.code}-application.pdf`);
}

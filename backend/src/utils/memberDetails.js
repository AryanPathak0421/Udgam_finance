/**
 * The details a member imported from the old system (legacyImport) still has to complete. They stay required: until every one is there
 * (the mobile number verified with an OTP, the photos approved in KYC) the member cannot be given a new loan.
 */
export const REQUIRED_DETAILS = [
  { key: 'mobile', label: 'Mobile number (verified with an OTP)' },
  { key: 'husbandName', label: 'Husband name' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'education', label: 'Education' },
  { key: 'address', label: 'Address' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'district', label: 'District' },
  { key: 'aadhaar', label: 'Aadhaar number' },
  { key: 'bankName', label: 'Bank name' },
  { key: 'ifsc', label: 'IFSC code' },
  { key: 'accountNumber', label: 'Account number' },
  { key: 'memberPhoto', label: 'Member photo' },
  { key: 'signaturePhoto', label: 'Signature' },
  { key: 'aadhaarPhoto', label: 'Aadhaar photo' },
];
const PHOTO_KEYS = new Set(['memberPhoto', 'signaturePhoto', 'aadhaarPhoto']);

// What a member must have before any loan requisition (group, personal, business / MSME, product), for every member.
const REQUISITION_TEXT = [
  ['name', 'Member name'], ['husbandName', 'Husband name'], ['dob', 'Date of birth'], ['gender', 'Gender'],
  ['occupation', 'Occupation'], ['education', 'Education'], ['address', 'Address'], ['area', 'Area (post office)'],
  ['pincode', 'Pincode'], ['state', 'State'], ['district', 'District'], ['aadhaar', 'Aadhaar number'],
  ['bankName', 'Bank name'], ['ifsc', 'IFSC code'], ['accountNumber', 'Account number'],
];
const REQUISITION_PHOTOS = [
  ['memberPhoto', 'Member photo'], ['signaturePhoto', 'Signature photo'], ['aadhaarPhoto', 'Aadhaar front photo'],
  ['aadhaarBackPhoto', 'Aadhaar back photo'], ['passbookPhoto', 'Bank passbook photo'],
];

/**
 * The details and photos a member still lacks for a loan requisition: PAN or Voter ID (number and photo), the mobile number
 * verified with an OTP, the personal details, the bank details and the photos. Empty when the member is complete.
 * The member's photos are read from kycKeys (they are not loaded with the member).
 */
export function requisitionGaps(m) {
  if (!m) return ['Member details'];
  const out = [];
  const keys = m.kycKeys || [];
  for (const [k, label] of REQUISITION_TEXT) if (!String(m[k] ?? '').trim()) out.push(label);
  if (!m.mobile || !m.mobileVerifiedAt) out.push('Mobile number verified with OTP');
  for (const [k, label] of REQUISITION_PHOTOS) if (!m[k] && !keys.includes(k)) out.push(label);
  if (!m.pan && !m.voterId) out.push('PAN number or Voter ID number');
  const idPhoto = m.panPhoto || keys.includes('panPhoto') || m.voterPhoto || keys.includes('voterPhoto');
  if (!idPhoto) out.push('PAN or Voter ID photo');
  return out;
}

/**
 * What the guarantor and the nominee still lack for a loan requisition, for every member. The guarantor needs name, Aadhaar number,
 * photo, signature, Aadhaar front and back, and the joint photo with the member. The nominee needs the same, except the joint photo.
 * A nominee who is the guarantor (sameAsGuarantor) copies the guarantor's details, so only the guarantor is checked for him.
 * A party with no name is left to the "add first" messages.
 */
export function partyGaps(m) {
  const out = [];
  const keys = m?.kycKeys || [];
  for (const [kind, label] of [['guarantor', 'Guarantor'], ['nominee', 'Nominee']]) {
    const p = m?.[kind];
    if (!p?.name) continue;
    if (kind === 'guarantor' && p.deceasedOn) continue; // a deceased guarantor is changed first (its own message)
    if (kind === 'nominee' && p.sameAsGuarantor) continue;
    const missing = [];
    if (!String(p.aadhaar ?? '').trim()) missing.push('Aadhaar number');
    for (const [k, l] of [['photo', 'Photo'], ['signature', 'Signature'], ['aadhaarPhoto', 'Aadhaar front photo'], ['aadhaarBackPhoto', 'Aadhaar back photo']]) {
      if (!p[k] && !keys.includes(`${kind}.${k}`)) missing.push(l);
    }
    if (kind === 'guarantor' && !p.jointPhoto && !keys.includes('guarantor.jointPhoto')) missing.push('Joint photo with the member');
    if (missing.length) out.push(`${label}: ${missing.join(', ')}`);
  }
  return out;
}

/** What a guarantor of a migrated member still lacks (empty when he is complete, deceased or there is none: a change of guarantor is for the admin). */
export function guarantorGaps(m) {
  const g = m?.guarantor;
  if (!m?.legacyImport || !g?.name || g.deceasedOn) return [];
  const keys = m.kycKeys || [];
  const has = (f) => Boolean(g[f]) || keys.includes(`guarantor.${f}`);
  return ['aadhaar', 'photo', 'signature', 'aadhaarPhoto', 'aadhaarBackPhoto', 'jointPhoto'].filter((f) => !has(f));
}

/** The required details a member does not have yet (empty for a member that was not imported). */
export function missingDetails(m) {
  if (!m?.legacyImport) return [];
  const out = REQUIRED_DETAILS.filter((d) => {
    if (d.key === 'mobile') return !m.mobile || !m.mobileVerifiedAt;
    // a photo is not loaded with the member: its entry in the list of documents says it exists
    if (PHOTO_KEYS.has(d.key)) return !m[d.key] && !(m.kycKeys || []).includes(d.key);
    return !String(m[d.key] || '').trim();
  });
  // a PAN number that came over needs its photo (the registration asks for it whenever a PAN is given)
  if (m.pan && !m.panPhoto && !(m.kycKeys || []).includes('panPhoto')) out.push({ key: 'panPhoto', label: 'PAN photo' });
  // The guarantor that came over has only a name: his Aadhaar number and documents are still to be added. The nominee has to be added.
  if (guarantorGaps(m).length) out.push({ key: 'guarantor', label: 'Guarantor details (Aadhaar number, photo, signature, Aadhaar front and back, joint photo with the member)' });
  if (!m.nominee?.name) out.push({ key: 'nominee', label: 'Nominee' });
  return out;
}

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

/** What a guarantor of a migrated member still lacks (empty when he is complete, deceased or there is none: a change of guarantor is for the admin). */
export function guarantorGaps(m) {
  const g = m?.guarantor;
  if (!m?.legacyImport || !g?.name || g.deceasedOn) return [];
  const keys = m.kycKeys || [];
  const has = (f) => Boolean(g[f]) || keys.includes(`guarantor.${f}`);
  return ['aadhaar', 'photo', 'signature', 'aadhaarPhoto'].filter((f) => !has(f));
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
  if (guarantorGaps(m).length) out.push({ key: 'guarantor', label: 'Guarantor details (Aadhaar number, photo, signature, Aadhaar photo)' });
  if (!m.nominee?.name) out.push({ key: 'nominee', label: 'Nominee' });
  return out;
}

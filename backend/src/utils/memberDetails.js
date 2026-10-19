/**
 * The details a member imported from the old system (legacyImport) still has to complete. They stay required: until every one is there
 * (the mobile number verified with an OTP, the photos approved in KYC) the member cannot be given a new loan.
 */
export const REQUIRED_DETAILS = [
  { key: 'mobile', label: 'Mobile number (verified with an OTP)' },
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

/** The required details a member does not have yet (empty for a member that was not imported). */
export function missingDetails(m) {
  if (!m?.legacyImport) return [];
  return REQUIRED_DETAILS.filter((d) => {
    if (d.key === 'mobile') return !m.mobile || !m.mobileVerifiedAt;
    // a photo is not loaded with the member: its entry in the list of documents says it exists
    if (PHOTO_KEYS.has(d.key)) return !m[d.key] && !(m.kycKeys || []).includes(d.key);
    return !String(m[d.key] || '').trim();
  });
}

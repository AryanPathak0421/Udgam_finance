/**
 * CGPey Identity & KYC Verification Service (PAN, Aadhaar OKYC, GST, Bank IFSC)
 * Directly imported and adapted from Rojsewa implementation.
 */

const getBaseUrl = () => (process.env.CGPEY_BASE_URL || 'https://verify.cgpey.com').replace(/\/$/, '');
const getMerchantId = () => process.env.CGPEY_MERCHANT_ID || '';
const getApiKey = () => process.env.CGPEY_API_KEY || '';
const getSecretKey = () => process.env.CGPEY_SECRET_KEY || '';

const getHeaders = () => ({
  'Content-Type': 'application/json',
  'x-merchant-id': getMerchantId(),
  'x-api-key': getApiKey(),
  'x-secret-key': getSecretKey(),
});

export const isCgpayConfigured = () => Boolean(getMerchantId() && getApiKey() && getSecretKey());
const isBypassEnabled = () => process.env.ALLOW_KYC_VERIFICATION_BYPASS === 'true';

async function postJson(endpoint, payload) {
  const url = `${getBaseUrl()}${endpoint}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(data?.message || `CGPey verification returned ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify PAN Number with CGPey
 * @param {string} pan
 */
export async function verifyPanWithCgpay(pan) {
  const cleanPan = String(pan || '').trim().toUpperCase();
  if (!cleanPan) throw new Error('PAN is required');

  try {
    const data = await postJson('/api/v1/verify/pan', { pan: cleanPan });
    return {
      success: true,
      status: data?.status || 'VERIFIED',
      data: data?.data || { pan: cleanPan, name: data?.name },
      message: data?.message || 'PAN verified successfully',
    };
  } catch (error) {
    console.error('CGPey PAN Verification Error:', error.message);

    if (isBypassEnabled()) {
      console.warn(`⚠️ [CGPEY BYPASS] PAN "${cleanPan}" auto-verified in dev/test mode.`);
      return {
        success: true,
        status: 'VERIFIED',
        data: { pan: cleanPan, name_match: true, name: 'VERIFIED HOLDER' },
        message: 'PAN verified successfully (dev bypass active)',
      };
    }

    throw error;
  }
}

/**
 * Verify GSTIN Number with CGPey
 * @param {string} gstNumber
 */
export async function verifyGstWithCgpay(gstNumber) {
  const cleanGst = String(gstNumber || '').trim().toUpperCase();
  if (!cleanGst) throw new Error('GST number is required');

  try {
    const data = await postJson('/api/v1/verify/gst', { gstNumber: cleanGst });
    return {
      success: true,
      status: data?.status || 'VERIFIED',
      data: data?.data || data,
      message: data?.message || 'GST verified successfully',
    };
  } catch (error) {
    console.error('CGPey GST Verification Error:', error.message);

    if (isBypassEnabled()) {
      console.warn(`⚠️ [CGPEY BYPASS] GST "${cleanGst}" auto-verified in dev/test mode.`);
      return {
        success: true,
        status: 'VERIFIED',
        data: {
          gstNumber: cleanGst,
          businessName: 'VERIFIED BUSINESS ENTERPRISE',
          tradeName: 'VERIFIED TRADERS',
          status: 'Active',
          stateCode: cleanGst.slice(0, 2),
        },
        message: 'GST verified successfully (dev bypass active)',
      };
    }

    throw error;
  }
}

/**
 * Initiate Aadhaar OKYC OTP with CGPey
 * @param {string} aadhaarNumber (12 digits)
 */
export async function initiateAadhaarOkyc(aadhaarNumber) {
  const cleanAadhaar = String(aadhaarNumber || '').replace(/\D/g, '');
  if (cleanAadhaar.length !== 12) {
    throw new Error('Valid 12-digit Aadhaar number is required');
  }

  try {
    const data = await postJson('/api/v1/verify/okyc/initiate', { aadhaarNumber: cleanAadhaar });
    return {
      success: true,
      status: data?.status || 'OTP_SENT',
      data: data?.data || { sessionId: data?.sessionId },
      message: data?.message || 'Aadhaar OTP sent successfully',
    };
  } catch (error) {
    console.error('CGPey OKYC Initiate Error:', error.message);

    if (isBypassEnabled()) {
      console.warn(`⚠️ [CGPEY BYPASS] Aadhaar "${cleanAadhaar}" OKYC auto-passed. Bypass OTP: 123456.`);
      return {
        success: true,
        status: 'OTP_SENT',
        data: { sessionId: `BYPASS-${Date.now()}` },
        message: 'OTP sent successfully (dev bypass: use 123456)',
      };
    }

    throw error;
  }
}

/**
 * Verify Aadhaar OKYC OTP with CGPey
 * @param {{ sessionId: string, otp: string, aadhaarNumber: string }} params
 */
export async function verifyAadhaarOkyc({ sessionId, otp, aadhaarNumber }) {
  const cleanAadhaar = String(aadhaarNumber || '').replace(/\D/g, '');
  const cleanOtp = String(otp || '').trim();

  if (!sessionId || !cleanOtp || !cleanAadhaar) {
    throw new Error('Session ID, OTP and Aadhaar Number are required');
  }

  if (String(sessionId).startsWith('BYPASS-')) {
    if (!isBypassEnabled()) {
      throw new Error('Invalid or expired session');
    }
    if (cleanOtp !== '123456') {
      throw new Error('Invalid OTP. Use 123456 in dev bypass mode.');
    }
    console.warn(`⚠️ [CGPEY BYPASS] Aadhaar "${cleanAadhaar}" OKYC verified.`);
    return {
      success: true,
      status: 'VERIFIED',
      data: {
        aadhaarNumber: cleanAadhaar,
        name: 'VERIFIED AADHAAR HOLDER',
        address: 'INDIA',
        photo: '',
      },
      message: 'Aadhaar verified successfully (dev bypass)',
    };
  }

  try {
    const data = await postJson('/api/v1/verify/okyc/verify', {
      sessionId,
      otp: cleanOtp,
      aadhaarNumber: cleanAadhaar,
    });
    return {
      success: true,
      status: data?.status || 'VERIFIED',
      data: data?.data || data,
      message: data?.message || 'Aadhaar verified successfully',
    };
  } catch (error) {
    console.error('CGPey OKYC Verify Error:', error.message);
    throw error;
  }
}

/**
 * Verify Bank IFSC code via Razorpay free lookup API
 * @param {string} ifscCode
 */
export async function verifyIfscCode(ifscCode) {
  const cleanIfsc = String(ifscCode || '').trim().toUpperCase();
  if (!cleanIfsc) throw new Error('IFSC code is required');

  const res = await fetch(`https://ifsc.razorpay.com/${cleanIfsc}`);
  if (!res.ok) {
    throw new Error('Invalid IFSC Code or details not found');
  }
  const data = await res.json();
  return {
    success: true,
    status: 'VERIFIED',
    data,
    message: 'IFSC verified successfully',
  };
}

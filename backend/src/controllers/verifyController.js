import {
  verifyPanWithCgpay,
  verifyGstWithCgpay,
  initiateAadhaarOkyc,
  verifyAadhaarOkyc,
  verifyIfscCode,
} from '../services/cgpayService.js';
import { Member } from '../models/Member.js';

/**
 * Verify PAN via CGPey
 * POST /api/verify/pan
 */
export async function verifyPanController(req, res) {
  const { pan, checkDuplicate } = req.body || {};
  if (!pan) {
    return res.status(400).json({ success: false, message: 'PAN number is required' });
  }

  const cleanPan = String(pan).trim().toUpperCase();
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(cleanPan)) {
    return res.status(400).json({ success: false, message: 'Invalid PAN format. Must be 10 characters (e.g. ABCDE1234F)' });
  }

  if (checkDuplicate) {
    const existing = await Member.findOne({ pan: cleanPan, isDeleted: false }).select('code name');
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `This PAN is already registered with member ${existing.name} (${existing.code})`,
      });
    }
  }

  try {
    const result = await verifyPanWithCgpay(cleanPan);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'PAN verification failed',
    });
  }
}

/**
 * Verify GST via CGPey
 * POST /api/verify/gst
 */
export async function verifyGstController(req, res) {
  const { gstNumber } = req.body || {};
  if (!gstNumber) {
    return res.status(400).json({ success: false, message: 'GST number is required' });
  }

  const cleanGst = String(gstNumber).trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(cleanGst)) {
    return res.status(400).json({ success: false, message: 'Invalid 15-character GST number format' });
  }

  try {
    const result = await verifyGstWithCgpay(cleanGst);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'GST verification failed',
    });
  }
}

/**
 * Initiate Aadhaar OKYC OTP via CGPey
 * POST /api/verify/okyc/initiate
 */
export async function initiateOkycController(req, res) {
  const { aadhaarNumber, checkDuplicate } = req.body || {};
  const cleanAadhaar = String(aadhaarNumber || '').replace(/\D/g, '');

  if (cleanAadhaar.length !== 12) {
    return res.status(400).json({ success: false, message: 'Valid 12-digit Aadhaar number is required' });
  }

  if (checkDuplicate) {
    const existing = await Member.findOne({ aadhaar: cleanAadhaar, isDeleted: false }).select('code name');
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `This Aadhaar is already registered with member ${existing.name} (${existing.code})`,
      });
    }
  }

  try {
    const result = await initiateAadhaarOkyc(cleanAadhaar);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Failed to initiate Aadhaar verification',
    });
  }
}

/**
 * Verify Aadhaar OKYC OTP via CGPey
 * POST /api/verify/okyc/verify
 */
export async function verifyOkycController(req, res) {
  const { sessionId, otp, aadhaarNumber } = req.body || {};

  if (!sessionId || !otp || !aadhaarNumber) {
    return res.status(400).json({ success: false, message: 'Session ID, OTP, and Aadhaar number are required' });
  }

  try {
    const result = await verifyAadhaarOkyc({ sessionId, otp, aadhaarNumber });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Aadhaar OTP verification failed',
    });
  }
}

/**
 * Verify Bank Account & IFSC
 * POST /api/verify/bank
 */
export async function verifyBankController(req, res) {
  const { ifscCode } = req.body || {};

  if (!ifscCode) {
    return res.status(400).json({ success: false, message: 'IFSC code is required' });
  }

  try {
    const result = await verifyIfscCode(ifscCode);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      message: err.message || 'Invalid IFSC code',
    });
  }
}

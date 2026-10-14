import nodemailer from 'nodemailer';

let transporter;

export const mailConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

/**
 * Sends an email. Returns true if handed to the SMTP server.
 * When SMTP is not configured nothing is sent: in development the message is printed
 * to the console so the flow can be tested; in production only a warning is logged
 * (links contain secrets and must not end up in logs).
 */
export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
    } else {
      console.warn('SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS); email was not sent.');
    }
    return false;
  }
  const from = process.env.MAIL_FROM || `Udgam Microfinance <${process.env.SMTP_USER}>`;
  await getTransporter().sendMail({ from, to, subject, text, html });
  return true;
}

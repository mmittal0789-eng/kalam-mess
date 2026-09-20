const nodemailer = require('nodemailer');

let transporter = null;

function initTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (user && pass) {
    const isGmail = user.includes('@gmail.com') || (process.env.SMTP_HOST && process.env.SMTP_HOST.includes('gmail'));
    
    if (isGmail) {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        auth: { user, pass },
        connectionTimeout: 6000,
        greetingTimeout: 6000,
        socketTimeout: 8000
      });
    } else {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
        pool: true,
        auth: { user, pass },
        connectionTimeout: 6000
      });
    }
    return true;
  }
  transporter = null;
  return false;
}

initTransporter();

async function sendOtpEmail(toEmail, otp) {
  const subject = `Your Digital Mess Card OTP: ${otp}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #f8fafc;">
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="font-size: 36px;">🍽️</span>
        <h2 style="color: #0f172a; margin: 8px 0 0 0; font-size: 20px;">A.P.J. Abdul Kalam Bhawan</h2>
        <p style="color: #64748b; font-size: 12px; margin: 4px 0 0 0;">Digital Mess Card System</p>
      </div>
      <p style="color: #334155; font-size: 15px;">Hello,</p>
      <p style="color: #334155; font-size: 15px;">Use the following One-Time Password (OTP) to log in to your mess card:</p>
      <div style="background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%); color: #ffffff; font-size: 32px; font-weight: 800; letter-spacing: 8px; text-align: center; padding: 18px; border-radius: 12px; margin: 24px 0; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);">
        ${otp}
      </div>
      <p style="color: #64748b; font-size: 13px; line-height: 1.5;">This OTP is valid for 10 minutes. Do not share this code with anyone.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">A.P.J. Abdul Kalam Bhawan Mess &bull; Single-Token Anti-Waste Protection</p>
    </div>
  `;

  console.log(`\n======================================`);
  console.log(`[EMAIL OTP DISPATCH]`);
  console.log(`Recipient: ${toEmail}`);
  console.log(`OTP Code : >>> ${otp} <<<`);
  console.log(`Status   : ${transporter ? 'Sending via SMTP (' + process.env.SMTP_HOST + ')' : 'Simulated (Dev Mode)'}`);
  console.log(`======================================\n`);

  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"Mess Digital Card" <${process.env.SMTP_USER}>`,
        to: toEmail,
        subject,
        html
      });
      return { sent: true, mode: 'smtp' };
    } catch (err) {
      console.error('[SMTP ERROR]:', err.message);
      return { sent: true, mode: 'simulated', warning: err.message };
    }
  }

  return { sent: true, mode: 'simulated' };
}

async function testSmtpConnection() {
  if (!transporter) {
    return { configured: false, message: 'SMTP credentials not configured. Currently in Simulation mode.' };
  }
  try {
    await transporter.verify();
    return { configured: true, ok: true, message: 'SMTP connection verified successfully!' };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}

module.exports = {
  sendOtpEmail,
  initTransporter,
  testSmtpConnection
};


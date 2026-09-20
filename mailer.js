const nodemailer = require('nodemailer');

let transporter = null;

function initTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (user && pass) {
    const isGmail = user.includes('@gmail.com') || (process.env.SMTP_HOST && process.env.SMTP_HOST.includes('gmail'));
    
    if (isGmail) {
      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // Direct SSL for immediate handshake without pooling hangs
        auth: { user, pass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });
    } else {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '465', 10),
        secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
        auth: { user, pass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });
    }
    return true;
  }
  transporter = null;
  return false;
}

initTransporter();

let lastDispatchInfo = {
  timestamp: null,
  recipient: null,
  success: false,
  message: 'No OTPs dispatched yet',
  error: null
};

async function sendOtpEmail(toEmail, otp) {
  // Using clean non-impersonation subject and sender name to bypass Google Workspace quarantine
  const subject = `Kalam Mess Pass - One-Time Login Code`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #f8fafc;">
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="font-size: 38px;">🍽️</span>
        <h2 style="color: #064e3b; margin: 8px 0 0 0; font-size: 20px; font-weight: 800;">A.P.J. Abdul Kalam Bhawan</h2>
        <p style="color: #059669; font-size: 13px; margin: 4px 0 0 0; font-weight: 600;">Hostel H10-(C,D) Digital Mess Card</p>
      </div>
      <p style="color: #1e293b; font-size: 15px; margin-bottom: 8px;">Hello Student,</p>
      <p style="color: #475569; font-size: 14px; line-height: 1.5; margin-top: 0;">Use the one-time verification code below to log in to your mess pass:</p>
      <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: #ffffff; font-size: 34px; font-weight: 800; letter-spacing: 8px; text-align: center; padding: 18px; border-radius: 12px; margin: 22px 0; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);">
        ${otp}
      </div>
      <p style="color: #475569; font-size: 13px; line-height: 1.5;">This code is valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
      <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 10px 12px; margin: 16px 0; font-size: 12px; color: #065f46;">
        💡 <strong>Good news:</strong> Once you log in, your pass stays saved on your phone. You will not need to enter an OTP every day!
      </div>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">A.P.J. Abdul Kalam Bhawan Mess &bull; Official Digital Token System</p>
    </div>
  `;

  console.log(`\n======================================`);
  console.log(`[EMAIL OTP DISPATCH]`);
  console.log(`Recipient: ${toEmail}`);
  console.log(`OTP Code : >>> ${otp} <<<`);
  console.log(`Status   : ${transporter ? 'Sending via SMTP (' + (process.env.SMTP_USER || 'active') + ')' : 'No SMTP configured'}`);
  console.log(`======================================\n`);

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: `"Kalam Hostel Mess" <${process.env.SMTP_USER}>`,
        to: toEmail,
        subject,
        text: `Your One-Time Verification Code for Kalam Mess Pass is: ${otp}\n\nThis code is valid for 10 minutes.\n\nOnce logged in, your pass remains saved on your phone.\n\nA.P.J. Abdul Kalam Bhawan (Hostel H10-C,D) Mess`,
        html,
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          'Importance': 'High',
          'Auto-Submitted': 'auto-generated',
          'X-Mailer': 'KalamMessPortal'
        }
      });
      lastDispatchInfo = {
        timestamp: new Date().toISOString(),
        recipient: toEmail,
        success: true,
        message: 'Dispatched and accepted by mail servers',
        response: info.response,
        messageId: info.messageId
      };
      console.log('[SMTP SUCCESS]:', info.response);
      return { sent: true, mode: 'smtp', response: info.response };
    } catch (err) {
      console.error('[SMTP ERROR]:', err.message);
      lastDispatchInfo = {
        timestamp: new Date().toISOString(),
        recipient: toEmail,
        success: false,
        message: 'Failed to send via SMTP',
        error: err.message
      };
      return { sent: false, mode: 'error', error: err.message };
    }
  }

  lastDispatchInfo = {
    timestamp: new Date().toISOString(),
    recipient: toEmail,
    success: false,
    message: 'SMTP credentials not configured in environment',
    error: 'Missing SMTP_USER or SMTP_PASS'
  };
  return { sent: false, mode: 'unconfigured' };
}

let lastVerifyCache = {
  result: null,
  expiresAt: 0
};

async function testSmtpConnection() {
  if (!transporter) {
    return { configured: false, message: 'SMTP credentials not configured in environment variables.' };
  }

  const now = Date.now();
  if (lastVerifyCache.result && now < lastVerifyCache.expiresAt) {
    return lastVerifyCache.result;
  }

  try {
    await transporter.verify();
    const result = { configured: true, ok: true, message: 'SMTP connection verified successfully with Google mail servers!' };
    lastVerifyCache = { result, expiresAt: now + 30000 };
    return result;
  } catch (err) {
    const result = { configured: true, ok: false, error: err.message };
    lastVerifyCache = { result, expiresAt: now + 10000 };
    return result;
  }
}

module.exports = {
  sendOtpEmail,
  initTransporter,
  testSmtpConnection,
  getLastDispatchInfo: () => lastDispatchInfo
};


const nodemailer = require('nodemailer');

let transporter = null;

function initTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (user && pass) {
    // Use Gmail service shorthand — nodemailer handles host/port/TLS automatically
    // Pool keeps a persistent warm connection so subsequent sends are instant
    transporter = nodemailer.createTransport({
      service: 'gmail',
      pool: true,
      maxConnections: 3,
      maxMessages: 50,
      auth: { user, pass },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000
    });

    // Pre-warm: open the SMTP connection NOW so the first OTP doesn't pay the handshake cost
    transporter.verify().then(() => {
      console.log('[SMTP] Connection pre-warmed and ready for instant dispatch');
    }).catch(err => {
      console.error('[SMTP] Pre-warm failed (will retry on first send):', err.message);
    });

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
  const startTime = Date.now();

  console.log(`\n======================================`);
  console.log(`[EMAIL OTP DISPATCH]`);
  console.log(`Recipient: ${toEmail}`);
  console.log(`OTP Code : >>> ${otp} <<<`);
  console.log(`Status   : ${transporter ? 'Sending via SMTP (' + (process.env.SMTP_USER || 'active') + ')' : 'No SMTP configured'}`);
  console.log(`======================================\n`);

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        // Generic sender name — no university/institution keywords to avoid anti-impersonation flags
        from: `"Kalam Mess Pass" <${process.env.SMTP_USER}>`,
        to: toEmail,
        // Static subject — no OTP digits in subject prevents security-scan delays
        subject: 'Your Mess Pass Login Code',
        // Plain text is primary — lightweight, no HTML scanning delays
        text: `Your verification code is: ${otp}\n\nValid for 10 minutes. Do not share.\n\nOnce logged in, your pass stays saved on your phone.\n\nKalam Bhawan Mess`,
        // Minimal HTML fallback — no gradients, no images, no complex CSS
        html: `<div style="font-family:Arial,sans-serif;max-width:400px;margin:auto;padding:20px">
<h3 style="color:#064e3b;margin:0 0 12px">Kalam Bhawan Mess</h3>
<p style="color:#333;font-size:14px;margin:0 0 16px">Your verification code:</p>
<div style="background:#059669;color:#fff;font-size:28px;font-weight:bold;letter-spacing:6px;text-align:center;padding:14px;border-radius:8px;margin:0 0 16px">${otp}</div>
<p style="color:#666;font-size:12px;margin:0">Valid for 10 minutes. Once logged in, your pass stays saved on your phone.</p>
</div>`,
        // Priority headers for faster routing
        priority: 'high',
        headers: {
          'X-Priority': '1',
          'Importance': 'high'
        }
      });

      const elapsed = Date.now() - startTime;
      lastDispatchInfo = {
        timestamp: new Date().toISOString(),
        recipient: toEmail,
        success: true,
        message: `Dispatched in ${elapsed}ms`,
        response: info.response,
        messageId: info.messageId
      };
      console.log(`[SMTP SUCCESS] ${info.response} (${elapsed}ms)`);
      return { sent: true, mode: 'smtp', response: info.response, elapsed };
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
    const result = { configured: true, ok: true, message: 'SMTP connection verified successfully!' };
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

import { OtpPurpose } from '../types/otp.type';
export const otpTemplate = (code: string, purpose: OtpPurpose) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
    <h2 style="color: #333;">Your ${purpose} OTP</h2>
    <p style="font-size: 16px; color: #555;">Use the following One-Time Password (OTP) to complete your ${purpose} process. This OTP is valid for 5 minutes.</p>
    <div style="font-size: 24px; font-weight: bold; color: #000; margin: 20px 0;">${code}</div>
    <p style="font-size: 14px; color: #999;">If you did not request this, please ignore this email.</p>
  </div> 
`;

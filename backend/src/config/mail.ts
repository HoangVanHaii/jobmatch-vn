import nodemailer from 'nodemailer';
export const mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    } : undefined
})
export const verifyMail = async () => {
    try {
        await mailer.verify();
        console.log('Mail server is ready to take messages');
    }
    catch (error) {
        console.error('Mail server is not ready:', error);
    }
}
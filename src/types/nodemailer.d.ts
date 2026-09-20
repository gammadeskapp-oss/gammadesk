/**
 * Minimal ambient types for nodemailer — only the surface the health-check
 * mailer uses. The package ships no types and we don't need the full API.
 */
declare module 'nodemailer' {
  interface SendMailOptions {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
  }
  interface Transporter {
    sendMail(options: SendMailOptions): Promise<{ messageId?: string }>;
  }
  interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  }
  export function createTransport(options: TransportOptions): Transporter;
  const _default: { createTransport: typeof createTransport };
  export default _default;
}

export declare const ADMIN_EMAIL: string;
export declare const ADMIN_PASSWORD: string;
export declare const OWNER_PASSWORD: string;
export declare function totpStep(at?: number): number;
export declare function totp(secret: string, step?: number): string;
export declare function enrolAdminTotp(base: string): Promise<string>;
export declare function nextAdminCode(secret: string): Promise<string>;
export declare function adminLoginBody(secret: string): Promise<{ email: string; password: string; totp: string; recordarme: boolean }>;
export declare function adminToken(base: string, secret: string): Promise<string>;
export declare function receiptPng(): Promise<Buffer>;
export declare function uniqueEmail(tag: string): string;
export declare function randomRnc(): string;
export declare function approvedInvitation(
  base: string,
  adminAccessToken: string,
  tag?: string,
): Promise<{ subscriptionId: string; email: string; negocio: string; invitation: string }>;
export declare function acceptInvitation(
  base: string,
  invitation: string,
  password?: string,
): Promise<{ res: Response; status: number; json: any; text: string }>;

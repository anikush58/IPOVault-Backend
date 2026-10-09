export interface AuthenticatedUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  authTime?: number;
  iss?: string;
  aud?: string;
  sub?: string;
  [key: string]: unknown;
}

export type UserRole = 'ADMIN' | 'MANAGER' | 'USER';

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

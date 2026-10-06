import { Role } from './roles';

/** Usuario autenticado que viaja en cada petición después del AuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  sessionId: string;
}

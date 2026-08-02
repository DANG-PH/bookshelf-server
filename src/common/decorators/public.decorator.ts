import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// marks a route as reachable without the PIN-issued JWT (e.g. /auth/login, /health)
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// marks a route as reachable without the admin JWT — reading the library
// (catalog, files, view counter) plus /auth/login and /health
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

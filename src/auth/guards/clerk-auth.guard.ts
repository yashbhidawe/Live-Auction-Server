import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      this.logger.warn('Request missing Authorization Bearer token');
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      this.logger.error('CLERK_SECRET_KEY is not set in environment');
      throw new UnauthorizedException('Server auth configuration error');
    }

    try {
      const result = await verifyToken(token, { secretKey });

      if (result.errors) {
        const errMsg = result.errors[0]?.message ?? 'Unknown verification error';
        this.logger.warn(`Token verification failed: ${errMsg}`);
        throw new UnauthorizedException(`Token verification failed: ${errMsg}`);
      }

      // Robust payload extraction: handle both result.data and direct payload
      const payload = (result as any).sub || (result as any).userId ? result : result.data;
      
      if (!payload) {
        this.logger.warn('Token verified but payload is empty or missing data wrapper');
        throw new UnauthorizedException('Invalid token payload: empty');
      }

      const sub = (payload as any).sub || (payload as any).userId;
      if (!sub) {
        const keys = Object.keys(payload).join(', ');
        this.logger.warn(`Token verified but missing sub/userId claim. Keys: ${keys}`);
        throw new UnauthorizedException(`Invalid token payload: no sub or userId claim. Found keys: ${keys}`);
      }

      this.logger.debug(`Authenticated clerkId=${sub}`);
      request.clerkId = sub;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Unexpected token verification error: ${err}`);
      throw new UnauthorizedException('Token verification failed');
    }
  }

  private extractToken(request: {
    headers?: Record<string, string>;
  }): string | null {
    const auth = request.headers?.['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return null;
    return auth.slice(7).trim() || null;
  }
}

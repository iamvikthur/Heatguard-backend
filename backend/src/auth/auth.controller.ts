import { BadRequestException, Body, Controller, Get, Post, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentUser, Public } from './auth.decorators.js';
import { verifyPassword } from './password.js';
import { type AuthUser, TokenService } from './token.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  // TODO(security): no rate limiting or lockout on failed logins yet.
  @Public()
  @Post('login')
  async login(@Body() body?: { email?: unknown; password?: unknown }) {
    if (typeof body?.email !== 'string' || typeof body.password !== 'string') {
      throw new BadRequestException('email and password are required');
    }
    const user = await this.prisma.user.findUnique({ where: { email: body.email.trim().toLowerCase() } });
    // Same answer for an unknown email and a wrong password.
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw new UnauthorizedException('Wrong email or password');
    }
    const { token, expiresAt } = this.tokens.sign({ id: user.id, orgId: user.orgId, role: user.role });
    return { token, expiresAt, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }

  @Get('me')
  async me(@CurrentUser() current: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: current.id },
      select: { id: true, name: true, email: true, role: true, orgId: true },
    });
    if (!user) throw new UnauthorizedException('Sign in required');
    return user;
  }
}

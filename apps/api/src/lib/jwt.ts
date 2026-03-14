import { FastifyInstance } from 'fastify';

export type AuthUser = {
  sub: string;
  email: string;
  name: string;
};

export async function signAccessToken(app: FastifyInstance, user: AuthUser): Promise<string> {
  return app.jwt.sign(user, {
    expiresIn: '7d'
  });
}

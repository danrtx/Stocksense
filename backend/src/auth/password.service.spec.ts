import { ConfigService } from '@nestjs/config';
import { isStrongPassword, PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService(new ConfigService({ BCRYPT_COST: 4 }));

  it('guarda un hash bcrypt, nunca el texto plano', async () => {
    const hash = await service.hash('MiClaveSegura1');
    expect(hash).not.toContain('MiClaveSegura1');
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    await expect(service.verify('MiClaveSegura1', hash)).resolves.toBe(true);
    await expect(service.verify('otra', hash)).resolves.toBe(false);
  });

  it('dos hashes de la misma clave son distintos (sal aleatoria)', async () => {
    expect(await service.hash('MiClaveSegura1')).not.toBe(await service.hash('MiClaveSegura1'));
  });

  it('verificar contra un usuario sin hash responde false', async () => {
    await expect(service.verify('loquesea', null)).resolves.toBe(false);
  });

  it.each([
    ['corta1', false],
    ['soloLetrasLargas', false],
    ['1234567890', false],
    ['ClaveSegura2026', true],
    ['contraseñaño9', true],
  ])('política de contraseña: %s → %s', (pwd, ok) => {
    expect(isStrongPassword(pwd)).toBe(ok);
  });
});

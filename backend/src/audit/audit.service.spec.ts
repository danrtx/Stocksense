import { diff } from './audit.service';

describe('diff de auditoría', () => {
  it('solo incluye los campos que cambiaron', () => {
    expect(diff({ name: 'A', cost: 10, unit: 'UND' }, { name: 'A', cost: 12 })).toEqual({
      cost: { from: 10, to: 12 },
    });
  });

  it('ignora valores undefined', () => {
    expect(diff({ role: 'BODEGA' }, { role: undefined })).toEqual({});
  });
});

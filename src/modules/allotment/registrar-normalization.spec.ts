import {
  RegistrarAdapterRegistry,
  normalizeRegistrarCode,
} from './adapters/registrar-adapter.registry';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';
import { MaashitlaRegistrarAdapter } from './adapters/maashitla-registrar.adapter';

describe('Registrar Normalization & Registry Resolution Tests', () => {
  let registry: RegistrarAdapterRegistry;
  let kfinAdapter: KfinRegistrarAdapter;
  let mufgAdapter: MufgIntimeRegistrarAdapter;
  let maashitlaAdapter: MaashitlaRegistrarAdapter;

  beforeEach(() => {
    registry = new RegistrarAdapterRegistry();
    kfinAdapter = new KfinRegistrarAdapter();
    mufgAdapter = new MufgIntimeRegistrarAdapter();
    maashitlaAdapter = new MaashitlaRegistrarAdapter();

    registry.register(kfinAdapter);
    registry.register(mufgAdapter);
    registry.register(maashitlaAdapter);
  });

  it('1. "KFin Technologies Limited" resolves KFINTECH adapter', () => {
    const adapter = registry.get('KFin Technologies Limited');
    expect(adapter).toBeDefined();
    expect(adapter?.code).toBe('KFINTECH');
  });

  it('2. "KFin Technologies" resolves KFINTECH adapter', () => {
    const adapter = registry.get('KFin Technologies');
    expect(adapter).toBeDefined();
    expect(adapter?.code).toBe('KFINTECH');
  });

  it('3. "KFINTECH" resolves KFINTECH adapter', () => {
    const adapter = registry.get('KFINTECH');
    expect(adapter).toBeDefined();
    expect(adapter?.code).toBe('KFINTECH');
  });

  it('4. Existing KFIN alias still works ("KFIN", "KFIN_TECH", "kfin")', () => {
    expect(registry.get('KFIN')?.code).toBe('KFINTECH');
    expect(registry.get('kfin')?.code).toBe('KFINTECH');
    expect(registry.get('KFIN_TECH')?.code).toBe('KFINTECH');
  });

  it('4b. Underscore variants resolve KFINTECH adapter ("KFIN_TECHNOLOGIES", "KFIN_TECHNOLOGIES_LIMITED")', () => {
    expect(registry.get('KFIN_TECHNOLOGIES')?.code).toBe('KFINTECH');
    expect(registry.get('kfin_technologies')?.code).toBe('KFINTECH');
    expect(registry.get('KFIN_TECHNOLOGIES_LIMITED')?.code).toBe('KFINTECH');
    expect(registry.get('KFIN_TECHNOLOGIES_PVT_LTD')?.code).toBe('KFINTECH');
    expect(registry.get('KFIN_TECHNOLOGIES_PRIVATE_LIMITED')?.code).toBe('KFINTECH');
  });

  it('5. Unknown registrar does NOT accidentally resolve to KFin', () => {
    expect(registry.get('CAMEO')).toBeUndefined();
    expect(registry.get('BIGSHARE')).toBeUndefined();
    expect(registry.get('UNKNOWN_REGISTRAR')).toBeUndefined();
    expect(registry.get('')).toBeUndefined();
    expect(registry.get(undefined)).toBeUndefined();
    expect(registry.get(null)).toBeUndefined();
  });

  it('6. normalizeRegistrarCode returns deterministic canonical codes', () => {
    expect(normalizeRegistrarCode('KFin Technologies Limited')).toBe('KFINTECH');
    expect(normalizeRegistrarCode('KFin Technologies')).toBe('KFINTECH');
    expect(normalizeRegistrarCode('KFINTECH')).toBe('KFINTECH');
    expect(normalizeRegistrarCode('KFIN')).toBe('KFINTECH');
    expect(normalizeRegistrarCode('MUFG Intime India (formerly Link Intime)')).toBe('MUFG_INTIME');
    expect(normalizeRegistrarCode('Link Intime')).toBe('MUFG_INTIME');
    expect(normalizeRegistrarCode('Maashitla Securities')).toBe('MAASHITLA');
    expect(normalizeRegistrarCode('MAASHITLA SECURITIES PRIVATE LIMITED')).toBe('MAASHITLA');
    expect(normalizeRegistrarCode('UNKNOWN')).toBe('UNKNOWN');
  });

  it('7. MUFG display names and aliases resolve MUFG_INTIME adapter', () => {
    expect(registry.get('MUFG_INTIME')?.code).toBe('MUFG_INTIME');
    expect(registry.get('MUFG')?.code).toBe('MUFG_INTIME');
    expect(registry.get('MUFG Intime India')?.code).toBe('MUFG_INTIME');
    expect(registry.get('Link Intime')?.code).toBe('MUFG_INTIME');
  });

  it('8. Maashitla display names and aliases resolve MAASHITLA adapter', () => {
    expect(registry.get('MAASHITLA')?.code).toBe('MAASHITLA');
    expect(registry.get('maashitla')?.code).toBe('MAASHITLA');
    expect(registry.get('MAASHITLA_SECURITIES')?.code).toBe('MAASHITLA');
    expect(registry.get('Maashitla Securities')?.code).toBe('MAASHITLA');
    expect(registry.get('MAASHITLA SECURITIES PRIVATE LIMITED')?.code).toBe('MAASHITLA');
    expect(registry.get('MAASHITLA_SECURITIES_PVT_LTD')?.code).toBe('MAASHITLA');
  });
});

import {
  RegistrarAdapterRegistry,
  normalizeRegistrarCode,
} from './adapters/registrar-adapter.registry';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';

describe('Registrar Normalization & Registry Resolution Tests', () => {
  let registry: RegistrarAdapterRegistry;
  let kfinAdapter: KfinRegistrarAdapter;
  let mufgAdapter: MufgIntimeRegistrarAdapter;

  beforeEach(() => {
    registry = new RegistrarAdapterRegistry();
    kfinAdapter = new KfinRegistrarAdapter();
    mufgAdapter = new MufgIntimeRegistrarAdapter();

    registry.register(kfinAdapter);
    registry.register(mufgAdapter);
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
    expect(normalizeRegistrarCode('UNKNOWN')).toBe('UNKNOWN');
  });

  it('7. MUFG display names and aliases resolve MUFG_INTIME adapter', () => {
    expect(registry.get('MUFG_INTIME')?.code).toBe('MUFG_INTIME');
    expect(registry.get('MUFG')?.code).toBe('MUFG_INTIME');
    expect(registry.get('MUFG Intime India')?.code).toBe('MUFG_INTIME');
    expect(registry.get('Link Intime')?.code).toBe('MUFG_INTIME');
  });
});

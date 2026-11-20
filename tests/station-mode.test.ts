// E30 (FAT-249..252): HMI tanpa login operator — sesi station.
// Pola test repo: pure logic + gateway stub (tanpa @testing-library/react /
// jsdom — bukan dependensi repo, dilarang menambah dependensi). Hook
// useAuthSession diuji lewat renderToString (useMemo jalan saat SSR);
// cabang yang memanggil setState (buka modal) TIDAK diuji lewat SSR karena
// asersinya vakum di sana — penolakan modal dijamin tiga call-site yang
// di-gate stationSession (openAuthModal / notifyUnauthorized / runProtected)
// dan diverifikasi inspeksi + suite hijau.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveAttributionOperatorId,
  resolveStationSession,
  STATION_CREDENTIAL_INVALID,
  STATION_SENSITIVE_DENIAL,
} from '../src/application/stationMode';
import { useAuthSession } from '../src/application/hooks/useAuthSession';
import type { AuthSessionApi, AuthSessionDeps } from '../src/application/hooks/useAuthSession';
import type { IAuthGateway } from '../src/domain/ports/IOeeBackend';

function stubGateway(overrides: Partial<IAuthGateway> = {}): IAuthGateway {
  return {
    loginWithPassword: vi.fn(),
    changePassword: vi.fn(),
    logout: vi.fn(),
    getToken: () => null,
    getStationId: () => null,
    setStationId: vi.fn(),
    refreshSession: vi.fn(async () => null),
    getCapabilities: vi.fn(async () => ({})),
    getAccessMode: vi.fn(async () => ({ mode: 'public', channel: 'lan' as const, mutationsAllowed: true })),
    ...overrides,
  } as unknown as IAuthGateway;
}

function renderAuthSession(deps: AuthSessionDeps): AuthSessionApi {
  let captured: AuthSessionApi | null = null;
  const Probe = () => {
    captured = useAuthSession(deps);
    return null;
  };
  renderToString(createElement(Probe));
  if (!captured) throw new Error('hook tidak ter-render');
  return captured;
}

describe('resolveStationSession — H30.1 (FAT-249)', () => {
  it('token + stationId tervalidasi + backend → sesi station', () => {
    expect(resolveStationSession({ useBackend: true, stationTokenPresent: true, stationId: 'STM32-OEE-01' }))
      .toEqual({ stationId: 'STM32-OEE-01' });
  });

  it('tanpa token station → null (fail-closed ke alur login)', () => {
    expect(resolveStationSession({ useBackend: true, stationTokenPresent: false, stationId: 'STM32-OEE-01' })).toBeNull();
  });

  it('tanpa stationId tervalidasi → null', () => {
    expect(resolveStationSession({ useBackend: true, stationTokenPresent: true, stationId: '' })).toBeNull();
    expect(resolveStationSession({ useBackend: true, stationTokenPresent: true, stationId: '   ' })).toBeNull();
  });

  it('mode simulasi → null (sesi station hanya backend)', () => {
    expect(resolveStationSession({ useBackend: false, stationTokenPresent: true, stationId: 'STM32-OEE-01' })).toBeNull();
  });
});

describe('useAuthSession — sesi station terbentuk dari registry + token env', () => {
  const baseDeps = (overrides: Partial<AuthSessionDeps> = {}): AuthSessionDeps => ({
    authGateway: stubGateway(),
    useBackend: true,
    stationIdEnv: 'STM32-OEE-01',
    stationTokenPresent: true,
    getRegisteredDeviceIds: () => ['STM32-OEE-01', 'STM32-OEE-02'],
    onAuthenticated: () => undefined,
    ...overrides,
  });

  it('token + stationId terdaftar → stationSession aktif, modal tertutup', () => {
    const api = renderAuthSession(baseDeps());
    expect(api.stationSession).toEqual({ stationId: 'STM32-OEE-01' });
    expect(api.isStationMode).toBe(true);
    expect(api.isAuthModalOpen).toBe(false);
  });

  it('registry belum termuat ([]) → tanpa sesi station', () => {
    const api = renderAuthSession(baseDeps({ getRegisteredDeviceIds: () => [] }));
    expect(api.stationSession).toBeNull();
    expect(api.isStationMode).toBe(false);
  });

  it('stationId env tak terdaftar → tanpa sesi station', () => {
    const api = renderAuthSession(baseDeps({ stationIdEnv: 'STATION-UNKNOWN' }));
    expect(api.stationSession).toBeNull();
  });

  it('tanpa token station → tanpa sesi station', () => {
    const api = renderAuthSession(baseDeps({ stationTokenPresent: false }));
    expect(api.stationSession).toBeNull();
  });

  it('runProtected mode station menjalankan aksi langsung (tanpa parkir login)', async () => {
    const api = renderAuthSession(baseDeps());
    let ran = false;
    await api.runProtected(async () => { ran = true; });
    expect(ran).toBe(true);
    expect(api.isAuthModalOpen).toBe(false);
  });

  it('runProtected tanpa sesi & tanpa token TIDAK menjalankan aksi (parkir login)', async () => {
    const api = renderAuthSession(baseDeps({ stationTokenPresent: false }));
    let ran = false;
    await api.runProtected(async () => { ran = true; });
    expect(ran).toBe(false);
  });
});

describe('resolveAttributionOperatorId — H30.3 (FAT-251)', () => {
  it('sesi operator selalu menang', () => {
    expect(resolveAttributionOperatorId({
      operatorSessionId: 'OPR-1001', isStationMode: true, activeWorkOrderOperatorId: 'OPR-2002',
    })).toBe('OPR-1001');
  });

  it('mode station + WO aktif → OID badge WO', () => {
    expect(resolveAttributionOperatorId({
      operatorSessionId: null, isStationMode: true, activeWorkOrderOperatorId: 'OPR-2002',
    })).toBe('OPR-2002');
  });

  it('mode station tanpa WO aktif → null jujur (tak mengarang operator)', () => {
    expect(resolveAttributionOperatorId({
      operatorSessionId: null, isStationMode: true, activeWorkOrderOperatorId: '',
    })).toBeNull();
    expect(resolveAttributionOperatorId({
      operatorSessionId: null, isStationMode: true, activeWorkOrderOperatorId: null,
    })).toBeNull();
  });

  it('bukan mode station tanpa sesi operator → null', () => {
    expect(resolveAttributionOperatorId({
      operatorSessionId: null, isStationMode: false, activeWorkOrderOperatorId: 'OPR-2002',
    })).toBeNull();
  });
});

describe('pesan penolakan E30 — H30.2/H30.4 (FAT-250/252)', () => {
  it('aksi sensitif mengarahkan ke admin panel', () => {
    expect(STATION_SENSITIVE_DENIAL).toContain('admin panel');
    expect(STATION_SENSITIVE_DENIAL).toContain('login');
  });

  it('kredensial station invalid mengarahkan ke re-commissioning, bukan login operator', () => {
    expect(STATION_CREDENTIAL_INVALID).toContain('commissioning');
    expect(STATION_CREDENTIAL_INVALID.toLowerCase()).not.toContain('login operator');
  });
});

// /src/application/stationMode.ts
// E30 (Linear FAT-249..252): HMI tanpa login operator — sesi station.
// Pure station-mode policy (no IO, no DOM, no infrastructure imports):
// sesi station, atribusi operator (OID), penolakan aksi sensitif.
// Hook useAuthSession / useOeeDashboard / useWorkOrders / useDeviceRegistry /
// useMachineActions memanggil fungsi ini; keputusan di sini teruji di
// tests/station-mode.test.ts.
//
// KONFLIK TERCATAT — jangan disembunyikan: ADR-0004 (Accepted 2026-11-20,
// decisions/0004) memutuskan "QR = data job, bukan autentikasi" dan
// mewajibkan sesi operator (dispatch Bearer). E30 membalik keputusan itu.
// Amandemen ADR dilacak di Linear D30.1 (FAT-260), BUKAN di repo ini —
// jangan edit decisions/ atau specs/ untuk E30.

/** Sesi station: kredensial terminal HMI, terikat satu mesin (stationId). */
export interface StationSession {
  stationId: string;
}

/**
 * E30 H30.1 (FAT-249): sesi station ada hanya bila ketiganya terpenuhi —
 * mode backend, token station env (VITE_API_TOKEN) tersedia, dan stationId
 * tervalidasi registry (pickStationId; '' = tanpa binding). Tanpa salah
 * satu → null (fail-closed: kiosk jatuh kembali ke alur login operator).
 */
export function resolveStationSession(input: {
  useBackend: boolean;
  stationTokenPresent: boolean;
  stationId: string;
}): StationSession | null {
  if (!input.useBackend) return null;
  if (!input.stationTokenPresent) return null;
  const stationId = input.stationId.trim();
  if (!stationId) return null;
  return { stationId };
}

/**
 * E30 H30.3 (FAT-251): operator untuk atribusi ack alarm / label downtime.
 * Sesi operator (bila ada) selalu menang. Tanpa sesi operator, mode station
 * memakai operator WO aktif — jobConfig.operatorId mesin aktif, yang diisi
 * backend dari WO.operator_id (OID badge zona QR saat initiate, atribusi
 * ganda OQ-102). Tanpa WO aktif → null jujur (tidak pernah mengarang id).
 */
export function resolveAttributionOperatorId(input: {
  operatorSessionId: string | null;
  isStationMode: boolean;
  activeWorkOrderOperatorId: string | null;
}): string | null {
  if (input.operatorSessionId) return input.operatorSessionId;
  if (!input.isStationMode) return null;
  const oid = (input.activeWorkOrderOperatorId ?? '').trim();
  return oid ? oid : null;
}

/**
 * E30 H30.4 (FAT-252): pesan penolakan aksi sensitif di mode station
 * (batalkan WO, ubah konfigurasi). Supervisor badge/PIN butuh backend
 * (Linear B30.1/B30.2) — belum ada; jangan ditebak, arahkan ke admin panel.
 */
export const STATION_SENSITIVE_DENIAL =
  'Aksi ini tidak tersedia di kiosk tanpa login — lakukan dari admin panel (login admin).';

/**
 * E30 H30.2 (FAT-250): pesan saat kredensial station ditolak backend (401).
 * Bukan sesi operator yang kedaluwarsa — station perlu re-commissioning.
 */
export const STATION_CREDENTIAL_INVALID =
  'Kredensial station tidak valid — station perlu di-commissioning ulang oleh admin.';

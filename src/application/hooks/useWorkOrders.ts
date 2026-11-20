// /src/application/hooks/useWorkOrders.ts
// Focused hook: backend work-order lifecycle (pending list, resolve preview,
// dispatch/complete/cancel) + production-setup modal.
// LAYER RULES: domain ports + React only — no infrastructure/*, no seeds, no DOM.

import { useCallback, useState } from 'react';
import type { MachineConfig } from '../../domain/entities/Machine';
import type {
  AckWaitState,
  InitiateFromZonesResult,
  WorkOrderListItem,
  WorkOrderResolveResult,
  ZoneRawStrings,
  ZoneType,
} from '../../domain/entities/backend/WorkOrder';
import type { GetMachinesUseCase } from '../use-cases/GetMachinesUseCase';
import type { ListWorkOrdersUseCase } from '../use-cases/ListWorkOrdersUseCase';
import { canMutate } from '../capabilityGate';
import { STATION_SENSITIVE_DENIAL } from '../stationMode';
import { useWorkOrderAckWait } from './useWorkOrderAckWait';

export interface WorkOrdersDeps {
  useBackend: boolean;
  currentDeviceId: string;
  /** totalCount mesin aktif untuk guard complete (FR-016); null = unknown. */
  currentTotalCount: number | null;
  listWorkOrdersUseCase: ListWorkOrdersUseCase;
  getMachinesUseCase: GetMachinesUseCase;
  runProtected: <T>(action: () => Promise<T>) => Promise<T | void>;
  capabilities: import('../../domain/ports/IOeeBackend').CapabilityMap | null;
  mutationsAllowed: boolean | null;
  /** E30 H30.4 (FAT-252): mode station — batalkan WO ditolak (admin panel). */
  isStationMode: boolean;
  setMachines: React.Dispatch<React.SetStateAction<MachineConfig[]>>;
}

export interface WorkOrdersApi {
  isProductionSetupModalOpen: boolean;
  openProductionSetupModal: () => void;
  closeProductionSetupModal: () => void;
  pendingWorkOrders: WorkOrderListItem[];
  workOrderError: string;
  workOrderPreview: { woId: string; result: WorkOrderResolveResult } | null;
  workOrderDetail: WorkOrderListItem | null;
  isWorkOrderDetailOpen: boolean;
  productionSetupError: string;
  productionSetupBusy: boolean;
  loadPendingWorkOrders: () => Promise<void>;
  previewWorkOrder: (woId: string) => Promise<void>;
  clearWorkOrderPreview: () => void;
  openWorkOrderDetail: (woId: string) => Promise<void>;
  closeWorkOrderDetail: () => void;
  dispatchWorkOrder: (woId: string, deviceId: string) => Promise<void>;
  completeWorkOrder: (woId: string, finalRejectCount: number) => Promise<void>;
  cancelWorkOrder: (woId: string, reason?: string) => Promise<void>;
  /** unit 002 FR-004: validate 4 zona → initiate WO + dispatch (Bearer, gate work_order.dispatch). */
  initiateFromZones: (deviceId: string, zones: ZoneRawStrings) => Promise<InitiateFromZonesResult | void>;
  /** unit 003 FR-005/006: status tunggu ACK edge pasca initiate/dispatch (poll bounded). */
  ackWait: AckWaitState | null;
}

export function useWorkOrders(deps: WorkOrdersDeps): WorkOrdersApi {
  const { useBackend, currentDeviceId, currentTotalCount, listWorkOrdersUseCase, getMachinesUseCase, runProtected, capabilities, mutationsAllowed, isStationMode, setMachines } = deps;

  const [isProductionSetupModalOpen, setIsProductionSetupModalOpen] = useState<boolean>(false);
  const [pendingWorkOrders, setPendingWorkOrders] = useState<WorkOrderListItem[]>([]);
  const [workOrderError, setWorkOrderError] = useState<string>('');
  const [workOrderPreview, setWorkOrderPreview] = useState<{ woId: string; result: WorkOrderResolveResult } | null>(null);
  const [workOrderDetail, setWorkOrderDetail] = useState<WorkOrderListItem | null>(null);
  const [isWorkOrderDetailOpen, setIsWorkOrderDetailOpen] = useState<boolean>(false);
  const [productionSetupError, setProductionSetupError] = useState<string>('');
  const [productionSetupBusy, setProductionSetupBusy] = useState<boolean>(false);
  // unit 003: tunggu ACK bersama untuk initiate (jalur A) dan dispatch (jalur B).
  const { ackWait, waitForAck } = useWorkOrderAckWait(listWorkOrdersUseCase);

  // ===== Production setup (§C list/resolve/dispatch/complete/cancel) =====
  const openProductionSetupModal = useCallback(() => {
    setProductionSetupError('');
    setWorkOrderPreview(null);
    setIsProductionSetupModalOpen(true);
  }, []);

  const closeProductionSetupModal = useCallback(() => setIsProductionSetupModalOpen(false), []);

  const loadPendingWorkOrders = useCallback(async () => {
    if (!useBackend) return;
    setWorkOrderError('');
    try {
      const pending = await listWorkOrdersUseCase.list({ status: 'PENDING', limit: 50 });
      setPendingWorkOrders(pending);
    } catch (err) {
      setWorkOrderError(err instanceof Error ? err.message : 'Gagal memuat work order.');
      throw err;
    }
  }, [listWorkOrdersUseCase, useBackend]);

  const previewWorkOrder = useCallback(async (woId: string) => {
    if (!useBackend) throw new Error('Preview work order hanya tersedia pada mode backend.');
    if (!currentDeviceId) throw new Error('Perangkat belum terikat pada mesin ini.');
    setWorkOrderError('');
    try {
      const result = await listWorkOrdersUseCase.resolve(woId, currentDeviceId);
      setWorkOrderPreview({ woId, result });
    } catch (err) {
      setWorkOrderPreview(null);
      throw err;
    }
  }, [currentDeviceId, listWorkOrdersUseCase, useBackend]);

  const clearWorkOrderPreview = useCallback(() => setWorkOrderPreview(null), []);

  const openWorkOrderDetail = useCallback(async (woId: string) => {
    if (!useBackend) throw new Error('Detail work order hanya tersedia pada mode backend.');
    setWorkOrderError('');
    try {
      const detail = await listWorkOrdersUseCase.detail(woId);
      setWorkOrderDetail(detail);
      setIsWorkOrderDetailOpen(true);
    } catch (err) {
      setWorkOrderDetail(null);
      setIsWorkOrderDetailOpen(false);
      throw err;
    }
  }, [listWorkOrdersUseCase, useBackend]);

  const closeWorkOrderDetail = useCallback(() => {
    setIsWorkOrderDetailOpen(false);
    setWorkOrderDetail(null);
  }, []);

  const dispatchWorkOrder = useCallback(async (woId: string, deviceId: string) => {
    const gate = canMutate({ useBackend, mutationsAllowed, capabilities, key: 'work_order.dispatch' });
    if (!gate.allowed) { setProductionSetupError(gate.reason); throw new Error(gate.reason); }
    if (!useBackend) throw new Error('Dispatch work order hanya tersedia pada mode backend.');
    setProductionSetupBusy(true);
    try {
      await runProtected(async () => {
        await listWorkOrdersUseCase.dispatch(woId, deviceId, 'Dispatch dari Production Setup dashboard');
        const machineList = await getMachinesUseCase.executeAll();
        setMachines(machineList);
        const pending = await listWorkOrdersUseCase.list({ status: 'PENDING', limit: 50 });
        setPendingWorkOrders(pending);
        setWorkOrderPreview(null);
        // unit 003 FR-006: tunggu ACK edge (poll bounded) — ACTIVE berarti START siap.
        void waitForAck(woId);
      });
    } catch (err) {
      setProductionSetupError(err instanceof Error ? err.message : 'Dispatch gagal.');
      throw err;
    } finally {
      setProductionSetupBusy(false);
    }
  }, [getMachinesUseCase, listWorkOrdersUseCase, runProtected, setMachines, useBackend, useBackend, mutationsAllowed, capabilities, waitForAck]);

  const completeWorkOrder = useCallback(async (woId: string, finalRejectCount: number) => {
    const gate = canMutate({ useBackend, mutationsAllowed, capabilities, key: 'work_order.update' });
    if (!gate.allowed) { setProductionSetupError(gate.reason); throw new Error(gate.reason); }
    if (!useBackend) throw new Error('Complete work order hanya tersedia pada mode backend.');
    // FR-016 guard klien: reject akhir tidak boleh melebihi total produksi
    // (backend 400 SCRAP_COUNT_INVALID; cegah sebelum fetch).
    if (!Number.isInteger(finalRejectCount) || finalRejectCount < 0) {
      setProductionSetupError('Reject akhir harus bilangan bulat ≥ 0.');
      throw new Error('Reject akhir harus bilangan bulat ≥ 0.');
    }
    if (currentTotalCount !== null && finalRejectCount > currentTotalCount) {
      const msg = `Reject akhir (${finalRejectCount}) melebihi total produksi (${currentTotalCount}).`;
      setProductionSetupError(msg);
      throw new Error(msg);
    }
    setProductionSetupBusy(true);
    try {
      await runProtected(async () => {
        await listWorkOrdersUseCase.complete(woId, finalRejectCount);
        const machineList = await getMachinesUseCase.executeAll();
        setMachines(machineList);
      });
    } catch (err) {
      const code = !!err && typeof err === 'object' ? String((err as { code?: unknown }).code ?? '') : '';
      setProductionSetupError(
        code === 'UNCLASSIFIED_DOWNTIME_CONFLICT'
          ? 'Downtime belum diklasifikasi — labeli alasan downtime dulu sebelum menyelesaikan WO.'
          : err instanceof Error ? err.message : 'Complete work order gagal.',
      );
      throw err;
    } finally {
      setProductionSetupBusy(false);
    }
  }, [currentTotalCount, getMachinesUseCase, listWorkOrdersUseCase, runProtected, setMachines, useBackend, useBackend, mutationsAllowed, capabilities]);

  const cancelWorkOrder = useCallback(async (woId: string, reason?: string) => {
    // E30 H30.4 (FAT-252): mode station — batalkan WO adalah aksi sensitif
    // (butuh otorisasi supervisor); ditolak di application layer sebelum
    // capability gate / fetch. Supervisor badge/PIN butuh backend (B30.1/
    // B30.2) — belum ada; jangan ditebak, arahkan ke admin panel. Tombol
    // Cancel TIDAK dihapus (layout live monitor beku); modal menampilkan
    // pesan ini dari productionSetupError / thrown error.
    if (isStationMode) { setProductionSetupError(STATION_SENSITIVE_DENIAL); throw new Error(STATION_SENSITIVE_DENIAL); }
    const gate = canMutate({ useBackend, mutationsAllowed, capabilities, key: 'work_order.cancel' });
    if (!gate.allowed) { setProductionSetupError(gate.reason); throw new Error(gate.reason); }
    if (!useBackend) throw new Error('Cancel work order hanya tersedia pada mode backend.');
    setProductionSetupBusy(true);
    try {
      await runProtected(async () => {
        await listWorkOrdersUseCase.cancel(woId, reason);
        const machineList = await getMachinesUseCase.executeAll();
        setMachines(machineList);
      });
    } catch (err) {
      setProductionSetupError(err instanceof Error ? err.message : 'Cancel work order gagal.');
      throw err;
    } finally {
      setProductionSetupBusy(false);
    }
  }, [getMachinesUseCase, listWorkOrdersUseCase, runProtected, setMachines, useBackend, useBackend, mutationsAllowed, capabilities, isStationMode]);

  // unit 002 FR-004: validate 4 zona berurutan (error per zona) → initiate.
  // initiate-from-zones backend SUDAH dispatch (MQTT config + watchdog tx);
  // POST /:wo_id/dispatch terpisah tidak dipanggil (akan konflik status).
  const initiateFromZones = useCallback(async (deviceId: string, zones: ZoneRawStrings) => {
    const gate = canMutate({ useBackend, mutationsAllowed, capabilities, key: 'work_order.dispatch' });
    if (!gate.allowed) { setProductionSetupError(gate.reason); throw new Error(gate.reason); }
    if (!useBackend) throw new Error('Initiate QR hanya tersedia pada mode backend.');
    setProductionSetupError('');
    setProductionSetupBusy(true);
    try {
      const result = await runProtected(async () => {
        const steps: Array<{ zone: keyof ZoneRawStrings; type: ZoneType }> = [
          { zone: 'product', type: 'PRODUCT' },
          { zone: 'machine', type: 'MACHINE' },
          { zone: 'operator', type: 'OPERATOR' },
          { zone: 'shift', type: 'SHIFT' },
        ];
        for (const step of steps) {
          const validation = await listWorkOrdersUseCase.validateZone(step.type, deviceId, zones[step.zone]);
          if (!validation.valid) {
            throw new Error(`Zona ${step.type}: ${validation.message ?? 'validasi gagal.'}`);
          }
        }
        const initiated = await listWorkOrdersUseCase.initiateFromZones(deviceId, zones);
        const machineList = await getMachinesUseCase.executeAll();
        setMachines(machineList);
        const pending = await listWorkOrdersUseCase.list({ status: 'PENDING', limit: 50 });
        setPendingWorkOrders(pending);
        // unit 003 FR-005: tunggu ACK edge (poll bounded) — WO PENDING sampai ACK SUCCESS.
        void waitForAck(initiated.workOrder.woId);
        return initiated;
      });
      return result;
    } catch (err) {
      setProductionSetupError(err instanceof Error ? err.message : 'Initiate work order gagal.');
      throw err;
    } finally {
      setProductionSetupBusy(false);
    }
  }, [getMachinesUseCase, listWorkOrdersUseCase, runProtected, setMachines, useBackend, mutationsAllowed, capabilities, waitForAck]);

  return {
    isProductionSetupModalOpen,
    openProductionSetupModal,
    closeProductionSetupModal,
    pendingWorkOrders,
    workOrderError,
    workOrderPreview,
    workOrderDetail,
    isWorkOrderDetailOpen,
    productionSetupError,
    productionSetupBusy,
    loadPendingWorkOrders,
    previewWorkOrder,
    clearWorkOrderPreview,
    openWorkOrderDetail,
    closeWorkOrderDetail,
    dispatchWorkOrder,
    completeWorkOrder,
    cancelWorkOrder,
    initiateFromZones,
    ackWait,
  };
}

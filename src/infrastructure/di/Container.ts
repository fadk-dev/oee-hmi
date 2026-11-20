// /src/infrastructure/di/Container.ts
// Composition root: the ONLY place that wires concrete adapters to use-cases.
// Presentation obtains the container via presentation/providers/DiProvider.
// Application layers must NOT import this file (dependency points inward).

import { IMachineRepository } from '../../domain/ports/IMachineRepository';
import { IAlarmRepository } from '../../domain/ports/IAlarmRepository';
import { IThemeStoragePort } from '../../domain/ports/IThemeStorage';
import type { IAuthTokenStorage } from '../../domain/ports/IAuthTokenStorage';
import type { IErrorReporter } from '../../domain/ports/IErrorReporter';
import type {
  IAuthGateway,
  IDeviceCommandGateway,
  ILiveStateRepository,
  IMasterDataRepository,
  IRealtimeGateway,
  ITelemetryRepository,
  IWorkOrderRepository,
} from '../../domain/ports/IOeeBackend';

import { InMemoryMachineRepository } from '../backend/services/InMemoryMachineRepository';
import { InMemoryAlarmRepository } from '../backend/services/InMemoryAlarmRepository';
import { BackendMachineRepository } from '../backend/services/BackendMachineRepository';
import { BackendAlarmRepository } from '../backend/services/BackendAlarmRepository';
import { LocalStorageThemeAdapter } from '../storage/LocalStorageThemeAdapter';
import { AuthTokenStorageAdapter } from '../storage/AuthTokenStorageAdapter';
import { NoopErrorReporter } from '../monitoring/ErrorReporter';
import {
  OeeHttpAuthGateway,
  OeeHttpDeviceCommandGateway,
  OeeHttpHealthRepository,
  OeeHttpLiveStateRepository,
  OeeHttpMasterDataRepository,
  OeeHttpShiftSummaryRepository,
  OeeHttpShiftTimelineRepository,
  OeeHttpTelemetryRepository,
  OeeHttpWorkOrderRepository,
} from '../backend/api-clients/oeeApiClient';
import { TelemetryWsClient } from '../realtime/telemetryWsClient';
import { env } from '../config/env';

import { CalculateOeeUseCase } from '../../application/use-cases/CalculateOeeUseCase';
import { GetMachinesUseCase } from '../../application/use-cases/GetMachinesUseCase';
import { UpdateMachineStatusUseCase } from '../../application/use-cases/UpdateMachineStatusUseCase';
import { LogDowntimeUseCase } from '../../application/use-cases/LogDowntimeUseCase';
import { LogRejectUseCase } from '../../application/use-cases/LogRejectUseCase';
import { ManageAlarmsUseCase } from '../../application/use-cases/ManageAlarmsUseCase';
import { MachineCommandUseCase } from '../../application/use-cases/MachineCommandUseCase';
import { ListWorkOrdersUseCase } from '../../application/use-cases/ListWorkOrdersUseCase';
import { GetShiftSummaryUseCase } from '../../application/use-cases/GetShiftSummaryUseCase';
import { GetShiftTimelineUseCase } from '../../application/use-cases/GetShiftTimelineUseCase';
import { SubscribeTelemetryUseCase } from '../../application/use-cases/SubscribeTelemetryUseCase';
import { GetDowntimeReasonsUseCase } from '../../application/use-cases/GetDowntimeReasonsUseCase';
import { GetActiveDowntimesUseCase } from '../../application/use-cases/GetActiveDowntimesUseCase';
import { GetHourlyTrendsUseCase } from '../../application/use-cases/GetHourlyTrendsUseCase';
import { GetTelemetryAggregateUseCase } from '../../application/use-cases/GetTelemetryAggregateUseCase';
import { GetTelemetryHistoryUseCase } from '../../application/use-cases/GetTelemetryHistoryUseCase';
import { ListLabelableDowntimesUseCase } from '../../application/use-cases/ListLabelableDowntimesUseCase';
import { LabelDowntimeReasonUseCase } from '../../application/use-cases/LabelDowntimeReasonUseCase';
import { GetRejectBreakdownUseCase } from '../../application/use-cases/GetRejectBreakdownUseCase';
import { ConfigureDeviceUseCase } from '../../application/use-cases/ConfigureDeviceUseCase';
import { ExportTelemetryUseCase } from '../../application/use-cases/ExportTelemetryUseCase';
import { GetHealthUseCase } from '../../application/use-cases/GetHealthUseCase';

export interface AppContainer {
  // Data source mode
  useBackend: boolean;
  /** Kiosk station binding dari env (composition root satu-satunya pembaca env). */
  stationIdEnv: string;
  /** E30 H30.1: token station env (VITE_API_TOKEN) tersedia — Bearer
      fallback httpClient; B30.1 kelak menggantinya kredensial per-station. */
  stationTokenPresent: boolean;

  // Ports / Repositories (lane depends on useBackend flag)
  machineRepository: IMachineRepository;
  alarmRepository: IAlarmRepository;
  themeStorage: IThemeStoragePort;
  authTokenStorage: IAuthTokenStorage;
  errorReporter: IErrorReporter;

  // Ports / Backend lane (real IIoT OEE REST + WS, see API_DOCUMENTATION.md)
  liveStateRepository: ILiveStateRepository;
  workOrderRepository: IWorkOrderRepository;
  deviceCommandGateway: IDeviceCommandGateway;
  masterDataRepository: IMasterDataRepository;
  telemetryRepository: ITelemetryRepository;
  authGateway: IAuthGateway;
  realtimeGateway: IRealtimeGateway;

  // Use cases (simulation lane)
  calculateOeeUseCase: CalculateOeeUseCase;
  getMachinesUseCase: GetMachinesUseCase;
  updateMachineStatusUseCase: UpdateMachineStatusUseCase;
  logDowntimeUseCase: LogDowntimeUseCase;
  logRejectUseCase: LogRejectUseCase;
  manageAlarmsUseCase: ManageAlarmsUseCase;
  machineCommandUseCase: MachineCommandUseCase;

  // Use cases (backend lane)
  listWorkOrdersUseCase: ListWorkOrdersUseCase;
  getShiftSummaryUseCase: GetShiftSummaryUseCase;
  getShiftTimelineUseCase: GetShiftTimelineUseCase;
  subscribeTelemetryUseCase: SubscribeTelemetryUseCase;
  getDowntimeReasonsUseCase: GetDowntimeReasonsUseCase;
  getActiveDowntimesUseCase: GetActiveDowntimesUseCase;
  getHourlyTrendsUseCase: GetHourlyTrendsUseCase;
  getRejectBreakdownUseCase: GetRejectBreakdownUseCase;
  getAggregateUseCase: GetTelemetryAggregateUseCase;
  getHistoryUseCase: GetTelemetryHistoryUseCase;
  listLabelableDowntimesUseCase: ListLabelableDowntimesUseCase;
  labelDowntimeReasonUseCase: LabelDowntimeReasonUseCase;
  configureDeviceUseCase: ConfigureDeviceUseCase;
  exportTelemetryUseCase: ExportTelemetryUseCase;
  getHealthUseCase: GetHealthUseCase;
}

/**
 * Creates and wires the dependency injection container.
 * In a Hexagonal Architecture, this Composition Root instantiates
 * infrastructure adapters and injects them into application use cases.
 *
 * Data source is controlled by VITE_USE_BACKEND:
 * - 'true': backend lane with HTTP repositories + TelemetryWsClient
 *   (.env.example ships 'true'; no env file at all falls back to 'false')
 * - otherwise: simulation lane with InMemory repositories
 */
export function createContainer(): AppContainer {
  const useBackend = env.useBackend;

  // 1. Adapters (Infrastructure)
  const liveStateRepository = new OeeHttpLiveStateRepository();
  const workOrderRepository = new OeeHttpWorkOrderRepository();
  const deviceCommandGateway = new OeeHttpDeviceCommandGateway();
  const masterDataRepository = new OeeHttpMasterDataRepository();
  const telemetryRepository = new OeeHttpTelemetryRepository();
  const authTokenStorage = new AuthTokenStorageAdapter();
  const errorReporter = new NoopErrorReporter();
  const authGateway = new OeeHttpAuthGateway(authTokenStorage);
  const healthRepository = new OeeHttpHealthRepository();
  const realtimeGateway = new TelemetryWsClient();
  const shiftSummaryRepository = new OeeHttpShiftSummaryRepository();
  const shiftTimelineRepository = new OeeHttpShiftTimelineRepository();

  const machineRepository = useBackend
    ? new BackendMachineRepository(
        liveStateRepository,
        masterDataRepository,
        workOrderRepository,
        deviceCommandGateway,
        telemetryRepository,
      )
    : new InMemoryMachineRepository();

  const alarmRepository = useBackend
    ? new BackendAlarmRepository(telemetryRepository, masterDataRepository)
    : new InMemoryAlarmRepository();

  const themeStorage = new LocalStorageThemeAdapter();

  // 2. Use Cases (Application) with Injected Adapters
  const calculateOeeUseCase = new CalculateOeeUseCase();
  const getMachinesUseCase = new GetMachinesUseCase(machineRepository);
  const updateMachineStatusUseCase = new UpdateMachineStatusUseCase(machineRepository, alarmRepository);
  const logDowntimeUseCase = new LogDowntimeUseCase(machineRepository, alarmRepository);
  const logRejectUseCase = new LogRejectUseCase(machineRepository);
  const manageAlarmsUseCase = new ManageAlarmsUseCase(alarmRepository);
  const machineCommandUseCase = new MachineCommandUseCase(machineRepository);
  const listWorkOrdersUseCase = new ListWorkOrdersUseCase(workOrderRepository);
  const getShiftSummaryUseCase = new GetShiftSummaryUseCase(shiftSummaryRepository);
  const getShiftTimelineUseCase = new GetShiftTimelineUseCase(shiftTimelineRepository);
  const subscribeTelemetryUseCase = new SubscribeTelemetryUseCase(realtimeGateway);
  const getDowntimeReasonsUseCase = new GetDowntimeReasonsUseCase(telemetryRepository);
  const getActiveDowntimesUseCase = new GetActiveDowntimesUseCase(telemetryRepository);
  const getHourlyTrendsUseCase = new GetHourlyTrendsUseCase(telemetryRepository);
  const getRejectBreakdownUseCase = new GetRejectBreakdownUseCase(telemetryRepository);
  const getAggregateUseCase = new GetTelemetryAggregateUseCase(telemetryRepository);
  const getHistoryUseCase = new GetTelemetryHistoryUseCase(telemetryRepository);
  const listLabelableDowntimesUseCase = new ListLabelableDowntimesUseCase(telemetryRepository);
  const labelDowntimeReasonUseCase = new LabelDowntimeReasonUseCase(telemetryRepository);
  const configureDeviceUseCase = new ConfigureDeviceUseCase(masterDataRepository);
  const exportTelemetryUseCase = new ExportTelemetryUseCase(telemetryRepository);
  const getHealthUseCase = new GetHealthUseCase(healthRepository);

  return {
    useBackend,
    stationIdEnv: env.stationIdEnv,
    stationTokenPresent: env.apiToken.trim().length > 0,
    machineRepository,
    alarmRepository,
    themeStorage,
    authTokenStorage,
    errorReporter,
    liveStateRepository,
    workOrderRepository,
    deviceCommandGateway,
    masterDataRepository,
    telemetryRepository,
    authGateway,
    realtimeGateway,
    calculateOeeUseCase,
    getMachinesUseCase,
    updateMachineStatusUseCase,
    logDowntimeUseCase,
    logRejectUseCase,
    manageAlarmsUseCase,
    machineCommandUseCase,
    listWorkOrdersUseCase,
    getShiftSummaryUseCase,
    getShiftTimelineUseCase,
    subscribeTelemetryUseCase,
    getDowntimeReasonsUseCase,
    getActiveDowntimesUseCase,
    getHourlyTrendsUseCase,
    getRejectBreakdownUseCase,
    getAggregateUseCase,
    getHistoryUseCase,
    listLabelableDowntimesUseCase,
    labelDowntimeReasonUseCase,
    configureDeviceUseCase,
    exportTelemetryUseCase,
    getHealthUseCase,
  };
}

// Default singleton instance
export const defaultContainer = createContainer();
